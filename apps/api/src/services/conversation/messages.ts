/**
 * Conversation timelines and message threads.
 *
 * Two reads live here because they share the participation check, the cursor
 * codec and the row mapper:
 *
 *   - the main timeline, which returns root messages plus a reply summary
 *   - one focused thread, which returns its root plus a page of replies
 *
 * Ordering: pages are selected newest first so the keyset works, then reversed
 * so a timeline reads oldest at the top. The newest reply sits at the bottom of
 * the thread.
 *
 * Used by: `routes/conversations.ts`.
 */

import { APIError } from "better-auth/api";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { conversationMessage, conversationThreadRead } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import {
	encodeCursor,
	loadMessageRecord,
	loadPeople,
	loadThreadRead,
	type MessageRecord,
	requireConversation,
	toMessageRow,
} from "./access";
import type {
	ConversationRootMessage,
	ConversationThreadPage,
	MessagePage,
	MessagePageQuery,
} from "./types";

/** Reply totals for a set of root messages. */
type ReplySummary = {
	replyCount: number;
	unreadReplyCount: number;
};

/** The scope every root read shares. */
function rootScope(organizationId: string, conversationId: string) {
	return and(
		eq(conversationMessage.organizationId, organizationId),
		eq(conversationMessage.conversationId, conversationId),
		isNull(conversationMessage.parentId),
	);
}

/** The scope every reply read shares. */
function replyScope(
	organizationId: string,
	conversationId: string,
	rootId: string,
) {
	return and(
		eq(conversationMessage.organizationId, organizationId),
		eq(conversationMessage.conversationId, conversationId),
		eq(conversationMessage.parentId, rootId),
	);
}

/**
 * Compare against an anchor row inside Postgres.
 *
 * Why not bind the anchor's `Date`: postgres.js cannot serialise a `Date`
 * inside this raw tuple comparison, and a JavaScript Date would also truncate
 * microseconds. Resolving the anchor by id keeps the stored value intact.
 *
 * The operator is explicit because the three page directions differ: `>` for a
 * forward gap, `<` for an older page, and `<=` for the page around a search hit.
 */
function anchorClause(anchorId: string, operator: "<" | "<=" | ">") {
	return sql`(${conversationMessage.createdAt}, ${conversationMessage.id}) ${sql.raw(
		operator,
	)} (
		select anchor.created_at, anchor.id
		from ${conversationMessage} as anchor
		where anchor.id = ${anchorId}
	)`;
}

/**
 * Reply counts and unread reply counts for the roots on one page.
 *
 * Why one grouped query: the main timeline only needs a number and a small
 * unread indicator per root. Loading the replies themselves would defeat the
 * page size, and an N+1 query per root would be worse.
 */
async function loadReplySummaries(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
	rootIds: string[],
): Promise<Map<string, ReplySummary>> {
	if (rootIds.length === 0) return new Map();

	const rows = await tx
		.select({
			rootId: conversationMessage.parentId,
			replyCount: sql<number>`count(*)`.mapWith(Number),
			unreadReplyCount: sql<number>`count(*) filter (
				where ${conversationMessage.deletedAt} is null
					and ${conversationMessage.authorId} is distinct from ${tenant.userId}
					and (
						${conversationThreadRead.id} is null
						or (${conversationMessage.createdAt}, ${conversationMessage.id}) > (
							${conversationThreadRead.lastReadAt},
							coalesce(${conversationThreadRead.lastReadMessageId}, '')
						)
					)
			)`.mapWith(Number),
		})
		.from(conversationMessage)
		.leftJoin(
			conversationThreadRead,
			and(
				eq(conversationThreadRead.rootMessageId, conversationMessage.parentId),
				eq(conversationThreadRead.userId, tenant.userId),
			),
		)
		.where(
			and(
				eq(conversationMessage.organizationId, tenant.organizationId),
				eq(conversationMessage.conversationId, conversationId),
				inArray(conversationMessage.parentId, rootIds),
			),
		)
		.groupBy(conversationMessage.parentId);

	const summaries = new Map<string, ReplySummary>();

	for (const row of rows) {
		if (!row.rootId) continue;

		summaries.set(row.rootId, {
			replyCount: row.replyCount,
			unreadReplyCount: row.unreadReplyCount,
		});
	}

	return summaries;
}

/** Map one root record into the wire shape with its reply summary. */
function toRootRow(
	record: MessageRecord,
	people: Parameters<typeof toMessageRow>[1],
	viewerId: string,
	summary: ReplySummary | undefined,
): ConversationRootMessage {
	return {
		...toMessageRow(record, people, viewerId),
		replyCount: summary?.replyCount ?? 0,
		unreadReplyCount: summary?.unreadReplyCount ?? 0,
	};
}

/**
 * One page of the main conversation timeline.
 *
 * Only roots are returned. `before` and `around` page backwards, `after` pages
 * forwards after a reconnect gap.
 */
export async function listConversationRoots(
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

				// A reply is not a timeline position. A link that names one is not
				// something this app produced.
				if (!anchor || anchor.parentId !== null) {
					throw new APIError("BAD_REQUEST", {
						message: "That message is not part of the main conversation.",
					});
				}
			}

			const scope = rootScope(tenant.organizationId, conversationId);

			if (query.after && anchor) {
				const rows = await tx
					.select()
					.from(conversationMessage)
					.where(and(scope, anchorClause(anchor.id, ">")))
					.orderBy(
						asc(conversationMessage.createdAt),
						asc(conversationMessage.id),
					)
					.limit(query.limit + 1);

				const hasNewer = rows.length > query.limit;
				const page = hasNewer ? rows.slice(0, query.limit) : rows;
				const [people, summaries] = await Promise.all([
					loadPeople(
						tenant.organizationId,
						page.map((record) => record.authorId),
					),
					loadReplySummaries(
						tx,
						tenant,
						conversationId,
						page.map((record) => record.id),
					),
				]);

				return {
					messages: page.map((record) =>
						toRootRow(record, people, tenant.userId, summaries.get(record.id)),
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
						? // `before` pages strictly older than its cursor, so the anchor
							// is not repeated. `around` includes the hit the reader clicked.
							and(scope, anchorClause(anchor.id, query.around ? "<=" : "<"))
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
			const [people, summaries] = await Promise.all([
				loadPeople(
					tenant.organizationId,
					pageDesc.map((record) => record.authorId),
				),
				loadReplySummaries(
					tx,
					tenant,
					conversationId,
					pageDesc.map((record) => record.id),
				),
			]);

			return {
				messages: [...pageDesc]
					.reverse()
					.map((record) =>
						toRootRow(record, people, tenant.userId, summaries.get(record.id)),
					),
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

/**
 * One page of one thread.
 *
 * The root is always returned. `before` pages backwards from a reply, and
 * `around` returns the page that ends at a search hit so the reader lands on
 * the message they clicked. The thread read cursor and the other person's
 * cursor travel with the page for receipts.
 */
export async function listThreadReplies(
	tenant: TenantContext,
	conversationId: string,
	rootId: string,
	query: MessagePageQuery,
): Promise<ConversationThreadPage> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);
			const rootRecord = await loadMessageRecord(
				tx,
				tenant,
				conversationId,
				rootId,
			);

			if (!rootRecord || rootRecord.parentId !== null) {
				throw new APIError("NOT_FOUND", {
					message: "That thread no longer exists.",
				});
			}

			const anchorId = query.around ?? query.before;
			let anchor: MessageRecord | null = null;

			if (anchorId && anchorId !== rootId) {
				anchor = await loadMessageRecord(tx, tenant, conversationId, anchorId);

				if (!anchor || anchor.parentId !== rootId) {
					throw new APIError("BAD_REQUEST", {
						message: "That message is not part of this thread.",
					});
				}
			}

			const scope = replyScope(tenant.organizationId, conversationId, rootId);

			const rows = await tx
				.select()
				.from(conversationMessage)
				.where(
					anchor
						? // `before` is exclusive; `around` keeps the hit in the page.
							and(scope, anchorClause(anchor.id, query.around ? "<=" : "<"))
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

			const [people, threadRead, counterpartRead, totals] = await Promise.all([
				loadPeople(tenant.organizationId, [
					rootRecord.authorId,
					...pageDesc.map((record) => record.authorId),
				]),
				loadThreadRead(tx, tenant, conversationId, rootId, tenant.userId),
				access.counterpart
					? loadThreadRead(
							tx,
							tenant,
							conversationId,
							rootId,
							access.counterpart.userId,
						)
					: Promise.resolve(null),
				tx
					.select({ count: sql<number>`count(*)`.mapWith(Number) })
					.from(conversationMessage)
					.where(scope),
			]);

			return {
				root: toMessageRow(rootRecord, people, tenant.userId),
				replies: [...pageDesc]
					.reverse()
					.map((record) => toMessageRow(record, people, tenant.userId)),
				/**
				 * The total across every page, so a thread with more replies than
				 * one page can still label itself honestly. Deleted replies are
				 * counted, exactly like the timeline chip.
				 */
				replyCount: totals[0]?.count ?? 0,
				nextCursor: hasMore && oldest ? encodeCursor(oldest.id) : null,
				threadRead,
				counterpartRead,
			};
		},
	);
}
