/**
 * Conversation listing.
 *
 * Why this file: the sidebar, the messages page and the unread badge all read
 * the same ordered list. Keeping the ordering, the cursor and the unread rule
 * in one place is what stops the badge from disagreeing with the list.
 *
 * The list is ordered by conversation activity, not by creation. A message
 * moves its conversation to the top in the same transaction, so the order is
 * one indexed read with no aggregation over messages.
 *
 * Used by: `routes/conversations.ts` and the open flow.
 */

import { APIError } from "better-auth/api";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import {
	conversation,
	conversationMessage,
	conversationParticipant,
} from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import {
	decodeCursor,
	encodeCursor,
	loadPeople,
	toParticipantView,
	toScope,
} from "./access";
import type {
	ConversationListQuery,
	ConversationListResult,
	ConversationRecord,
	ConversationSummary,
} from "./types";

/** A participant row as the database stores it. */
type ParticipantRecord = typeof conversationParticipant.$inferSelect;

/**
 * Build one conversation summary.
 *
 * Shared with the open and read paths so the header, the list row and the
 * realtime patch all render the same shape.
 */
export function buildConversationSummary(input: {
	record: ConversationRecord;
	participants: ParticipantRecord[];
	people: Map<
		string,
		{ name: string; email: string; image: string | null; isMember: boolean }
	>;
	viewerId: string;
	unread: number;
}): ConversationSummary {
	const viewer = input.participants.find(
		(participant) => participant.userId === input.viewerId,
	);
	const counterpart =
		input.record.scope === "direct"
			? (input.participants.find(
					(participant) => participant.userId !== input.viewerId,
				) ?? null)
			: null;
	const lastAuthor = input.record.lastMessageAuthorId
		? input.people.get(input.record.lastMessageAuthorId)
		: undefined;

	return {
		id: input.record.id,
		scope: toScope(input.record.scope),
		title: input.record.title,
		counterpart: counterpart
			? toParticipantView(counterpart, input.people)
			: null,
		participants: input.participants.map((participant) =>
			toParticipantView(participant, input.people),
		),
		lastMessage: {
			id: input.record.lastMessageId,
			authorId: input.record.lastMessageAuthorId,
			authorName: lastAuthor?.name || lastAuthor?.email || null,
			preview: input.record.lastMessagePreview,
			createdAt: input.record.lastMessageAt
				? input.record.lastMessageAt.toISOString()
				: null,
		},
		unread: input.unread,
		muted: Boolean(viewer?.mutedAt),
		createdAt: input.record.createdAt.toISOString(),
		updatedAt: input.record.updatedAt.toISOString(),
	};
}

/** One page of conversations, newest activity first. */
export async function listConversations(
	tenant: TenantContext,
	query: ConversationListQuery,
): Promise<ConversationListResult> {
	const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

	if (query.cursor && !cursorId) {
		throw new APIError("BAD_REQUEST", {
			message: "That conversations page link is no longer valid.",
		});
	}

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			/*
			 * Resolve the cursor inside Postgres so the comparison uses the stored
			 * timestamp. A JavaScript Date would lose microseconds and could skip
			 * or repeat a page.
			 */
			const cursorClause = cursorId
				? sql`(${conversation.lastMessageAt}, ${conversation.id}) < (
						select cursor_conversation.last_message_at, cursor_conversation.id
						from ${conversation} as cursor_conversation
						where cursor_conversation.id = ${cursorId}
							and cursor_conversation.organization_id = ${tenant.organizationId}
					)`
				: undefined;

			// One extra row answers "is there another page" without a count.
			const rows = await tx
				.select({
					conversation,
					viewer: conversationParticipant,
				})
				.from(conversation)
				.innerJoin(
					conversationParticipant,
					and(
						eq(conversationParticipant.conversationId, conversation.id),
						eq(conversationParticipant.userId, tenant.userId),
					),
				)
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						// An empty conversation is not a chat yet. It appears the moment
						// the first message is sent.
						isNotNull(conversation.lastMessageAt),
						...(cursorClause ? [cursorClause] : []),
					),
				)
				.orderBy(desc(conversation.lastMessageAt), desc(conversation.id))
				.limit(query.limit + 1);

			const hasMore = rows.length > query.limit;
			const page = hasMore ? rows.slice(0, query.limit) : rows;
			const ids = page.map((row) => row.conversation.id);

			/*
			 * Unread is counted, never stored.
			 *
			 * A stored counter would have to be written by the sender into the
			 * recipient's row, which the self-only participant update policy
			 * forbids. The range read below is exact, drift free, and bounded by
			 * the message index. The prefilter skips a conversation whose newest
			 * message is already read, so fully read chats cost no message scan.
			 */
			const unreadRows =
				ids.length > 0
					? await tx
							.select({
								conversationId: conversationMessage.conversationId,
								unread: sql<number>`least(count(*), 99)`.mapWith(Number),
							})
							.from(conversationMessage)
							.innerJoin(
								conversationParticipant,
								and(
									eq(
										conversationParticipant.conversationId,
										conversationMessage.conversationId,
									),
									eq(conversationParticipant.userId, tenant.userId),
								),
							)
							.innerJoin(
								conversation,
								eq(conversation.id, conversationMessage.conversationId),
							)
							.where(
								and(
									eq(conversationMessage.organizationId, tenant.organizationId),
									inArray(conversationMessage.conversationId, ids),
									sql`${conversation.lastMessageAt} > ${conversationParticipant.lastReadAt}`,
									isNull(conversationMessage.deletedAt),
									sql`${conversationMessage.authorId} is distinct from ${tenant.userId}`,
									sql`(${conversationMessage.createdAt}, ${conversationMessage.id}) > (
										${conversationParticipant.lastReadAt},
										coalesce(${conversationParticipant.lastReadMessageId}, '')
									)`,
								),
							)
							.groupBy(conversationMessage.conversationId)
					: [];

			const unreadByConversation = new Map(
				unreadRows.map((row) => [row.conversationId, row.unread]),
			);

			// The badge counts every unread conversation, not only this page.
			const totalRows = await tx
				.select({
					conversationId: conversationMessage.conversationId,
					unread: sql<number>`least(count(*), 99)`.mapWith(Number),
				})
				.from(conversationMessage)
				.innerJoin(
					conversationParticipant,
					and(
						eq(
							conversationParticipant.conversationId,
							conversationMessage.conversationId,
						),
						eq(conversationParticipant.userId, tenant.userId),
					),
				)
				.innerJoin(
					conversation,
					eq(conversation.id, conversationMessage.conversationId),
				)
				.where(
					and(
						eq(conversationMessage.organizationId, tenant.organizationId),
						isNotNull(conversation.lastMessageAt),
						sql`${conversation.lastMessageAt} > ${conversationParticipant.lastReadAt}`,
						isNull(conversationMessage.deletedAt),
						sql`${conversationMessage.authorId} is distinct from ${tenant.userId}`,
						sql`(${conversationMessage.createdAt}, ${conversationMessage.id}) > (
							${conversationParticipant.lastReadAt},
							coalesce(${conversationParticipant.lastReadMessageId}, '')
						)`,
					),
				)
				.groupBy(conversationMessage.conversationId);

			const unreadTotal = totalRows.reduce((sum, row) => sum + row.unread, 0);

			const participantRows =
				ids.length > 0
					? await tx
							.select()
							.from(conversationParticipant)
							.where(
								and(
									eq(
										conversationParticipant.organizationId,
										tenant.organizationId,
									),
									inArray(conversationParticipant.conversationId, ids),
								),
							)
					: [];

			const participantsByConversation = new Map<string, ParticipantRecord[]>();

			for (const participant of participantRows) {
				const list =
					participantsByConversation.get(participant.conversationId) ?? [];
				list.push(participant);
				participantsByConversation.set(participant.conversationId, list);
			}

			const people = await loadPeople(tenant.organizationId, [
				...participantRows.map((participant) => participant.userId),
				...page.map((row) => row.conversation.lastMessageAuthorId),
			]);

			const conversations = page.map((row) =>
				buildConversationSummary({
					record: row.conversation,
					participants:
						participantsByConversation.get(row.conversation.id) ?? [],
					people,
					viewerId: tenant.userId,
					unread: unreadByConversation.get(row.conversation.id) ?? 0,
				}),
			);

			const last = page[page.length - 1];

			return {
				conversations,
				unreadTotal,
				nextCursor: hasMore && last ? encodeCursor(last.conversation.id) : null,
			};
		},
	);
}

/**
 * Count unread messages in one conversation.
 *
 * Used by the header and by the open flow, which need one number rather than a
 * page. The rule is identical to the list, so the two cannot disagree.
 */
export async function countConversationUnread(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
): Promise<number> {
	const [row] = await tx
		.select({
			unread: sql<number>`least(count(*), 99)`.mapWith(Number),
		})
		.from(conversationMessage)
		.innerJoin(
			conversationParticipant,
			and(
				eq(
					conversationParticipant.conversationId,
					conversationMessage.conversationId,
				),
				eq(conversationParticipant.userId, tenant.userId),
			),
		)
		.where(
			and(
				eq(conversationMessage.organizationId, tenant.organizationId),
				eq(conversationMessage.conversationId, conversationId),
				isNull(conversationMessage.deletedAt),
				sql`${conversationMessage.authorId} is distinct from ${tenant.userId}`,
				sql`(${conversationMessage.createdAt}, ${conversationMessage.id}) > (
					${conversationParticipant.lastReadAt},
					coalesce(${conversationParticipant.lastReadMessageId}, '')
				)`,
			),
		);

	return row?.unread ?? 0;
}
