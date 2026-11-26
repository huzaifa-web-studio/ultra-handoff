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
	conversationThreadRead,
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
	ConversationScope,
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
	const scope = toScope(input.record.scope);

	return {
		id: input.record.id,
		scope,
		title: input.record.title,
		visibility: input.record.visibility === "public" ? "public" : "private",
		description: input.record.description,
		archivedAt: input.record.archivedAt
			? input.record.archivedAt.toISOString()
			: null,
		memberCount: input.record.memberCount,
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
		canManage: scope === "group" && viewer?.role === "owner",
		createdAt: input.record.createdAt.toISOString(),
		updatedAt: input.record.updatedAt.toISOString(),
	};
}

/**
 * Unread condition shared by the list, the badge and the bell.
 *
 * A root is unread when it is after the conversation cursor. A reply is unread
 * when it is after its thread cursor, or when the thread has never been opened,
 * so a reply never becomes read just because the conversation was opened.
 *
 * The caller joins `conversation_participant` for the viewer and left joins
 * `conversation_thread_read` on the reply's root, or on the root itself.
 */
function unreadMessageCondition() {
	return sql`(
		(${conversationMessage.parentId} is null and (
			(${conversationMessage.createdAt}, ${conversationMessage.id}) > (
				${conversationParticipant.lastReadAt},
				coalesce(${conversationParticipant.lastReadMessageId}, '')
			)
		))
		or
		(${conversationMessage.parentId} is not null and (
			${conversationThreadRead.id} is null
			or (${conversationMessage.createdAt}, ${conversationMessage.id}) > (
				${conversationThreadRead.lastReadAt},
				coalesce(${conversationThreadRead.lastReadMessageId}, '')
			)
		))
	)`;
}

/**
 * Unread counts for a set of conversations, or for a whole scope.
 *
 * Why one helper: the direct list, the channel list and the in conversation
 * count all read the same two cursors. Keeping the query here means a change to
 * the unread rule is made once.
 *
 * `ids` limits the read to a page. `scope` limits the read to one conversation
 * type and is used by the section badges. Neither is set when the caller wants
 * every conversation the viewer participates in.
 */
export async function countUnreadByConversation(
	tx: TenantTx,
	tenant: TenantContext,
	options: { ids?: string[]; scope?: ConversationScope } = {},
): Promise<Map<string, number>> {
	if (options.ids && options.ids.length === 0) return new Map();

	const threadJoin = and(
		eq(
			conversationThreadRead.rootMessageId,
			sql`coalesce(${conversationMessage.parentId}, ${conversationMessage.id})`,
		),
		eq(conversationThreadRead.userId, tenant.userId),
	);

	const conditions = [
		eq(conversationMessage.organizationId, tenant.organizationId),
		isNull(conversationMessage.deletedAt),
		sql`${conversationMessage.authorId} is distinct from ${tenant.userId}`,
		unreadMessageCondition(),
	];

	if (options.ids) {
		conditions.push(inArray(conversationMessage.conversationId, options.ids));
	}

	if (options.scope) {
		conditions.push(eq(conversation.scope, options.scope));
		conditions.push(isNull(conversation.archivedAt));
	}

	const rows = await tx
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
				isNull(conversationParticipant.leftAt),
			),
		)
		.leftJoin(conversationThreadRead, threadJoin)
		.innerJoin(
			conversation,
			eq(conversation.id, conversationMessage.conversationId),
		)
		.where(and(...conditions))
		.groupBy(conversationMessage.conversationId);

	return new Map(rows.map((row) => [row.conversationId, row.unread]));
}

/** Sum one unread map, for a section badge. */
export function sumUnread(unread: Map<string, number>): number {
	let total = 0;

	for (const value of unread.values()) {
		total += value;
	}

	return total;
}

/** One page of conversations, newest activity first. */ export async function listConversations(
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
			 * A cursor that decodes to text is not necessarily a conversation id.
			 * Resolve it against the viewer's own conversations first, so a hand
			 * edited or stale page link gets a clear 400 instead of an empty list
			 * that looks like "you have no chats".
			 */
			if (cursorId) {
				const [cursorConversation] = await tx
					.select({ id: conversation.id })
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
							eq(conversation.id, cursorId),
							// This list is direct only. A channel id is not a valid
							// position in it.
							eq(conversation.scope, "direct"),
						),
					)
					.limit(1);

				if (!cursorConversation) {
					throw new APIError("BAD_REQUEST", {
						message: "That conversations page link is no longer valid.",
					});
				}
			}

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
						isNull(conversationParticipant.leftAt),
					),
				)
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						// This endpoint is the direct message list. Channels have
						// their own listing so an empty channel can appear before its
						// first message.
						eq(conversation.scope, "direct"),
						isNull(conversation.archivedAt),
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
			 * forbids. The shared helper below is the one rule the DM list, the
			 * channel list and the bell all read, so they cannot disagree.
			 */
			const unreadByConversation = await countUnreadByConversation(tx, tenant, {
				ids,
			});

			// The badge counts every unread direct conversation, not only this
			// page. Channels have their own section badge.
			const unreadTotal = sumUnread(
				await countUnreadByConversation(tx, tenant, { scope: "direct" }),
			);

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
	const unread = await countUnreadByConversation(tx, tenant, {
		ids: [conversationId],
	});

	return unread.get(conversationId) ?? 0;
}
