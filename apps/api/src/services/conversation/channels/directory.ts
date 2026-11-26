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

import { APIError } from "better-auth/api";
import {
	and,
	asc,
	desc,
	eq,
	ilike,
	inArray,
	isNotNull,
	isNull,
	sql,
} from "drizzle-orm";

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

/**
 * Keyset cursor for the public directory.
 *
 * The order is member count descending, then name ascending, then id ascending.
 * The cursor carries the whole tuple because the three keys are not unique on
 * their own, and a single id cursor would skip or repeat rows when two channels
 * share a member count and a name (private channels may share a name with a
 * public one, and archived channels are excluded).
 */
type BrowseCursor = {
	memberCount: number;
	title: string;
	id: string;
};

/** Encode one directory row as an opaque cursor. */
export function encodeBrowseCursor(row: BrowseCursor): string {
	return Buffer.from(JSON.stringify(row), "utf8").toString("base64url");
}

/** Decode a directory cursor, rejecting anything this app did not produce. */
export function decodeBrowseCursor(value: string): BrowseCursor | null {
	let parsed: unknown;

	try {
		parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		return null;
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}

	const record = parsed as Record<string, unknown>;

	if (typeof record.memberCount !== "number") return null;
	if (!Number.isInteger(record.memberCount) || record.memberCount < 0) {
		return null;
	}
	if (typeof record.title !== "string") return null;
	if (typeof record.id !== "string" || record.id.length === 0) return null;
	if (record.id.length > 64 || record.title.length > 200) return null;

	return {
		memberCount: record.memberCount,
		title: record.title,
		id: record.id,
	};
}

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
				// One extra row answers "was this capped" without a count.
				.limit(CHANNEL_LIST_MAX + 1);

			const hasMore = rows.length > CHANNEL_LIST_MAX;
			const page = hasMore ? rows.slice(0, CHANNEL_LIST_MAX) : rows;
			const ids = page.map((row) => row.conversation.id);
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
				...page.map((row) => row.conversation.lastMessageAuthorId),
			]);

			return {
				channels: page.map((row) =>
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
				truncated: hasMore,
			};
		},
	);
}

/**
 * Archived channels the viewer still belongs to.
 *
 * Archiving removes a channel from the rail and from browse, so without this
 * list an owner could only restore it from a tab that was still open. The order
 * is the most recently archived first. Unread is reported as zero because an
 * archived channel is read only and must not drive the section badge.
 */
export async function listArchivedChannels(
	tenant: TenantContext,
): Promise<ChannelListResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
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
						isNotNull(conversation.archivedAt),
					),
				)
				.orderBy(desc(conversation.archivedAt), desc(conversation.id))
				.limit(CHANNEL_LIST_MAX + 1);

			const hasMore = rows.length > CHANNEL_LIST_MAX;
			const page = hasMore ? rows.slice(0, CHANNEL_LIST_MAX) : rows;
			const ids = page.map((row) => row.conversation.id);

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
				...page.map((row) => row.conversation.lastMessageAuthorId),
			]);

			return {
				channels: page.map((row) =>
					buildConversationSummary({
						record: row.conversation,
						participants:
							participantsByConversation.get(row.conversation.id) ?? [],
						people,
						viewerId: tenant.userId,
						unread: 0,
					}),
				),
				unreadTotal: 0,
				truncated: hasMore,
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
	const cursor = query.cursor ? decodeBrowseCursor(query.cursor) : null;

	if (query.cursor && !cursor) {
		throw new APIError("BAD_REQUEST", {
			message: "That channel page link is no longer valid.",
		});
	}

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const cursorClause = cursor
				? sql`(
						${conversation.memberCount} < ${cursor.memberCount}
						or (
							${conversation.memberCount} = ${cursor.memberCount}
							and lower(${conversation.title}) > ${cursor.title}
						)
						or (
							${conversation.memberCount} = ${cursor.memberCount}
							and lower(${conversation.title}) = ${cursor.title}
							and ${conversation.id} > ${cursor.id}
						)
					)`
				: undefined;

			const limit = Math.min(query.limit, CHANNEL_LIST_MAX);
			const rows = await tx
				.select({
					id: conversation.id,
					title: conversation.title,
					// The cursor must use the same lowercase value the ORDER BY
					// uses. A JavaScript toLowerCase can disagree with Postgres
					// `lower()` on a locale specific letter.
					sortTitle: sql<string>`lower(${conversation.title})`,
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
						...(cursorClause ? [cursorClause] : []),
					),
				)
				.orderBy(
					sql`${conversation.memberCount} desc`,
					asc(sql`lower(${conversation.title})`),
					asc(conversation.id),
				)
				.limit(limit + 1);

			const hasMore = rows.length > limit;
			const page = hasMore ? rows.slice(0, limit) : rows;
			const ids = page.map((row) => row.id);
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
			const last = page[page.length - 1];

			return {
				channels: page.map((row) => ({
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
				nextCursor:
					hasMore && last
						? encodeBrowseCursor({
								memberCount: last.memberCount,
								title: last.sortTitle,
								id: last.id,
							})
						: null,
			};
		},
	);
}
