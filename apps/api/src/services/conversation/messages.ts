/**
 * Conversation message pages.
 *
 * Why this file: the thread reads one page at a time in three directions
 * (older, newer, around a search hit). All three share the participation check,
 * the ordering rule and the receipt lookup, so they live together.
 *
 * Ordering: newest page first from the database, then reversed, so a chat reads
 * oldest at the top and the newest message is at the bottom of the pane.
 *
 * Used by: `routes/conversations.ts`.
 */

import { APIError } from "better-auth/api";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { conversationMessage } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import {
	encodeCursor,
	loadMessageRecord,
	loadPeople,
	type MessageRecord,
	requireConversation,
	toMessageRow,
} from "./access";
import type { MessagePage, MessagePageQuery } from "./types";

/** The scope every page read shares. */
function messageScope(organizationId: string, conversationId: string) {
	return and(
		eq(conversationMessage.organizationId, organizationId),
		eq(conversationMessage.conversationId, conversationId),
	);
}

/**
 * One page of messages.
 *
 * `before` and `around` page backwards and return an ascending page.
 * `after` pages forwards and returns the messages in the order they arrived,
 * which is what the client uses to recover a gap after a reconnect.
 */
export async function listConversationMessages(
	tenant: TenantContext,
	conversationId: string,
	query: MessagePageQuery,
): Promise<MessagePage> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);
			const anchorId = query.before ?? query.after ?? query.around;

			let anchor: MessageRecord | null = null;

			if (anchorId) {
				anchor = await loadMessageRecord(tx, tenant, conversationId, anchorId);

				// A message id from another conversation is not a page link this
				// app produced, so it is rejected rather than silently ignored.
				if (!anchor) {
					throw new APIError("BAD_REQUEST", {
						message: "That message is not part of this conversation.",
					});
				}
			}

			const scope = messageScope(tenant.organizationId, conversationId);

			if (query.after && anchor) {
				const rows = await tx
					.select()
					.from(conversationMessage)
					.where(
						and(
							scope,
							sql`(${conversationMessage.createdAt}, ${conversationMessage.id}) > (${anchor.createdAt}, ${anchor.id})`,
						),
					)
					.orderBy(
						asc(conversationMessage.createdAt),
						asc(conversationMessage.id),
					)
					.limit(query.limit + 1);

				const hasNewer = rows.length > query.limit;
				const page = hasNewer ? rows.slice(0, query.limit) : rows;
				const people = await loadPeople(
					tenant.organizationId,
					page.map((record) => record.authorId),
				);

				return {
					messages: page.map((record) =>
						toMessageRow(record, people, tenant.userId),
					),
					nextCursor: null,
					hasNewer,
					counterpartRead: access.counterpart
						? {
								lastReadAt: access.counterpart.lastReadAt.toISOString(),
								lastReadMessageId: access.counterpart.lastReadMessageId,
							}
						: null,
				};
			}

			const rows = await tx
				.select()
				.from(conversationMessage)
				.where(
					anchor
						? and(
								scope,
								sql`(${conversationMessage.createdAt}, ${conversationMessage.id}) <= (${anchor.createdAt}, ${anchor.id})`,
							)
						: scope,
				)
				.orderBy(
					desc(conversationMessage.createdAt),
					desc(conversationMessage.id),
				)
				.limit(query.limit + 1);

			const hasMore = rows.length > query.limit;
			const pageDesc = hasMore ? rows.slice(0, query.limit) : rows;
			const oldest = pageDesc[pageDesc.length - 1];
			const people = await loadPeople(
				tenant.organizationId,
				pageDesc.map((record) => record.authorId),
			);

			return {
				messages: [...pageDesc]
					.reverse()
					.map((record) => toMessageRow(record, people, tenant.userId)),
				nextCursor: hasMore && oldest ? encodeCursor(oldest.id) : null,
				hasNewer: false,
				counterpartRead: access.counterpart
					? {
							lastReadAt: access.counterpart.lastReadAt.toISOString(),
							lastReadMessageId: access.counterpart.lastReadMessageId,
						}
					: null,
			};
		},
	);
}
