/**
 * Channel directory reads.
 *
 * Two lists:
 *
 *   - joined: every channel the viewer is an active member of, including a
 *     channel with no messages yet, so a new channel appears immediately;
 *   - browse: every public channel in the workspace, with the joined flag.
 *
 * Private channels are intentionally absent from browse. A reader learns about
 * one only by being added.
 *
 * Used by: `routes/channels/`.
 */

import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";

import { conversation, conversationParticipant } from "../../../db/schema";
import { withTenant } from "../../../db/tenant";
import { escapeLike } from "../../../lib/query";
import type { TenantContext } from "../../../middleware/tenant";
import { loadPeople } from "../access";
import {
	buildConversationSummary,
	countUnreadByConversation,
	sumUnread,
} from "../list";
import {
	CHANNEL_LIST_MAX,
	type ChannelBrowseQuery,
	type ChannelBrowseResult,
	type ChannelListResult,
} from "../types";

/** Active channels the viewer has joined, newest activity first. */
export async function listChannels(
	tenant: TenantContext,
): Promise<ChannelListResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			/*
			 * A channel with no messages sorts by its creation time, so it still
			 * appears at a sensible place in the rail. The list is capped instead
			 * of paginated because a workspace with hundreds of joined channels
			 * is far outside this product's range, and the rail needs every row
			 * for its unread badge anyway.
			 */
			const rows = await tx
				.select({ conversation, viewer: conversationParticipant })
				.from(conversation)
				.innerJoin(
					conversationParticipant,
					and(
						eq(conversationParticipant.conversationId, conversation.id),
						eq(conversationParticipant.userId, tenant.userId),
						isNull(conversationParticipant.leftAt),
					),
				)
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						eq(conversation.scope, "group"),
						isNull(conversation.archivedAt),
					),
				)
				.orderBy(
					sql`coalesce(${conversation.lastMessageAt}, ${conversation.createdAt}) desc`,
					sql`${conversation.id} desc`,
				)
				.limit(CHANNEL_LIST_MAX);

			const ids = rows.map((row) => row.conversation.id);
			const unreadByConversation = await countUnreadByConversation(tx, tenant, {
				ids,
			});

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
									isNull(conversationParticipant.leftAt),
								),
							)
					: [];

			const participantsByConversation = new Map<
				string,
				(typeof participantRows)[number][]
			>();

			for (const participant of participantRows) {
				const list =
					participantsByConversation.get(participant.conversationId) ?? [];
				list.push(participant);
				participantsByConversation.set(participant.conversationId, list);
			}

			const people = await loadPeople(tenant.organizationId, [
				...participantRows.map((participant) => participant.userId),
				...rows.map((row) => row.conversation.lastMessageAuthorId),
			]);

			return {
				channels: rows.map((row) =>
					buildConversationSummary({
						record: row.conversation,
						participants:
							participantsByConversation.get(row.conversation.id) ?? [],
						people,
						viewerId: tenant.userId,
						unread: unreadByConversation.get(row.conversation.id) ?? 0,
					}),
				),
				unreadTotal: sumUnread(
					await countUnreadByConversation(tx, tenant, { scope: "group" }),
				),
			};
		},
	);
}

/**
 * Browse public channels, newest member first, then alphabetical.
 *
 * The conversation row is readable by the whole workspace for a public group,
 * which is what makes this possible without joining. The `joined` flag comes
 * from the viewer's own participant rows, the only rows the select policy
 * allows a reader to see.
 */
export async function browseChannels(
	tenant: TenantContext,
	query: ChannelBrowseQuery,
): Promise<ChannelBrowseResult> {
	const term = query.search.trim();
	const pattern = term.length > 0 ? `%${escapeLike(term)}%` : null;

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const rows = await tx
				.select({
					id: conversation.id,
					title: conversation.title,
					description: conversation.description,
					memberCount: conversation.memberCount,
					lastMessageAt: conversation.lastMessageAt,
					lastMessagePreview: conversation.lastMessagePreview,
					createdAt: conversation.createdAt,
				})
				.from(conversation)
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						eq(conversation.scope, "group"),
						eq(conversation.visibility, "public"),
						isNull(conversation.archivedAt),
						...(pattern ? [ilike(conversation.title, pattern)] : []),
					),
				)
				.orderBy(
					sql`${conversation.memberCount} desc`,
					asc(sql`lower(${conversation.title})`),
					asc(conversation.id),
				)
				.limit(Math.min(query.limit, CHANNEL_LIST_MAX));

			const ids = rows.map((row) => row.id);
			const joinedRows =
				ids.length > 0
					? await tx
							.select({
								conversationId: conversationParticipant.conversationId,
							})
							.from(conversationParticipant)
							.where(
								and(
									eq(
										conversationParticipant.organizationId,
										tenant.organizationId,
									),
									eq(conversationParticipant.userId, tenant.userId),
									isNull(conversationParticipant.leftAt),
									inArray(conversationParticipant.conversationId, ids),
								),
							)
					: [];

			const joined = new Set(joinedRows.map((row) => row.conversationId));

			return {
				channels: rows.map((row) => ({
					id: row.id,
					title: row.title ?? "Untitled channel",
					description: row.description,
					memberCount: row.memberCount,
					joined: joined.has(row.id),
					lastMessageAt: row.lastMessageAt
						? row.lastMessageAt.toISOString()
						: null,
					lastMessagePreview: row.lastMessagePreview,
					createdAt: row.createdAt.toISOString(),
				})),
				nextCursor: null,
			};
		},
	);
}
