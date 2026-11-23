/**
 * Message read state.
 *
 * Why a cursor per thread: the product asks "which is the oldest message I have
 * not read" inside a discussion, including its replies. A monotonic cursor per
 * thread root answers that with one row and makes two open tabs safe. A
 * per-message read set would be larger, harder to keep consistent and would
 * still need a cursor to render the divider.
 *
 * Two calculations share this module:
 *   - an in-memory calculation for a page of comments the caller already
 *     loaded, which never compares timestamps in JavaScript for the cursor
 *   - a SQL count for the whole milestone and project, which the badges need
 *     without loading every comment
 *
 * Baseline rule: a person added to a project with months of history should not
 * open the app to a backlog they were never part of. The effective start is the
 * later of the organization membership and the project membership.
 *
 * Used by: services/comment.service.ts, services/milestone.service.ts and
 * src/routes/comments.ts.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
	comment,
	commentThreadRead,
	milestone,
	notification,
	projectMember,
} from "../db/schema";
import { type TenantTx, withTenant } from "../db/tenant";
import { COMMENT_NOTIFICATION_TYPES } from "../lib/notification-types";
import type { TenantContext } from "../middleware/tenant";
import { requireMilestoneAccess } from "./milestone.service";
import { loadProjectAccess } from "./project.service";

/** The unread state of one thread. */
export type CommentUnread = {
	count: number;
	/** The oldest message the viewer has not read, or null when caught up. */
	firstUnreadCommentId: string | null;
};

/** A stored cursor for one thread root. */
export type ThreadReadCursor = {
	lastReadAt: Date;
	lastReadCommentId: string;
};

/** The minimum comment shape the in-memory calculation needs. */
export type ReadableComment = {
	id: string;
	authorId: string | null;
	kind: string;
	createdAt: Date;
	deletedAt: Date | null;
};

/** One thread's refreshed state after a mark request. */
export type ThreadReadResult = {
	rootCommentId: string;
	unread: CommentUnread;
};

/** The response of one mark request. */
export type MarkCommentsReadResult = {
	unreadTotal: number;
	threads: ThreadReadResult[];
};

/** One milestone's unread count, used by the project summary. */
export type MilestoneUnreadResult = {
	milestoneId: string;
	unread: number;
};

/** Project level unread summary for the workspace badges. */
export type ProjectUnreadSummary = {
	total: number;
	milestones: MilestoneUnreadResult[];
};

/**
 * Compute unread state for one thread from an ordered list.
 *
 * The cursor is matched by id, not by timestamp. Postgres stores microseconds
 * while JavaScript keeps milliseconds, so comparing Date objects for two
 * comments in the same millisecond could put the divider in the wrong place.
 * The rows arrive ordered by `(created_at, id)`, which is the canonical order,
 * so the cursor's position in that list is exact.
 */
export function computeThreadUnread(input: {
	comments: readonly ReadableComment[];
	viewerId: string;
	baselineAt: Date;
	cursorId: string | null;
}): CommentUnread {
	// Match the SQL order exactly. The cursor is a tuple of
	// `(created_at, id)`, so finding it in an array that only follows the UI's
	// root-first order could put a tied reply on the wrong side of the cursor.
	const ordered = [...input.comments].sort((left, right) => {
		const time = left.createdAt.getTime() - right.createdAt.getTime();

		return time !== 0 ? time : left.id.localeCompare(right.id);
	});
	const cursorIndex = input.cursorId
		? ordered.findIndex((item) => item.id === input.cursorId)
		: -1;
	const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
	let count = 0;
	let firstUnreadCommentId: string | null = null;

	for (const item of ordered.slice(start)) {
		// A cursor older than the membership baseline cannot happen through the
		// UI, but a data repair could produce it. The baseline still wins.
		if (cursorIndex < 0 && item.createdAt <= input.baselineAt) continue;
		if (item.kind !== "comment") continue;
		if (item.deletedAt !== null) continue;
		if (item.authorId === input.viewerId) continue;

		count += 1;

		if (firstUnreadCommentId === null) firstUnreadCommentId = item.id;
	}

	return { count, firstUnreadCommentId };
}

/**
 * The effective unread baseline for one person in one project.
 *
 * `memberCreatedAt` comes from the verified tenant context. A project
 * membership row can be later, for example when somebody joins an existing
 * workspace and is then added to a project. The later value wins.
 */
export async function loadUnreadBaseline(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
): Promise<Date> {
	const [row] = await tx
		.select({ createdAt: projectMember.createdAt })
		.from(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, tenant.organizationId),
				eq(projectMember.projectId, projectId),
				eq(projectMember.userId, tenant.userId),
			),
		)
		.limit(1);

	const projectJoinedAt = row?.createdAt ?? null;

	if (projectJoinedAt && projectJoinedAt > tenant.memberCreatedAt) {
		return projectJoinedAt;
	}

	return tenant.memberCreatedAt;
}

/** Load the viewer's cursors for a set of thread roots. */
export async function loadThreadReadCursors(
	tx: TenantTx,
	tenant: TenantContext,
	rootIds: readonly string[],
): Promise<Map<string, ThreadReadCursor>> {
	if (rootIds.length === 0) return new Map();

	const rows = await tx
		.select({
			rootCommentId: commentThreadRead.rootCommentId,
			lastReadAt: commentThreadRead.lastReadAt,
			lastReadCommentId: commentThreadRead.lastReadCommentId,
		})
		.from(commentThreadRead)
		.where(
			and(
				eq(commentThreadRead.organizationId, tenant.organizationId),
				eq(commentThreadRead.userId, tenant.userId),
				inArray(commentThreadRead.rootCommentId, [...rootIds]),
			),
		);

	return new Map(
		rows.map((row) => [
			row.rootCommentId,
			{
				lastReadAt: row.lastReadAt,
				lastReadCommentId: row.lastReadCommentId,
			},
		]),
	);
}

/**
 * The thread root for a comment id.
 *
 * A reply stores its root in `parent_id`. A root stores null. This helper keeps
 * the two cases in one place.
 */
export function threadRootId(
	commentId: string,
	parentId: string | null,
): string {
	return parentId ?? commentId;
}

/**
 * Advance the author's own cursor after they post.
 *
 * Why: a person's own message is never unread to them. Without this, posting a
 * message in a thread they had never opened would leave a divider above their
 * own text. The upsert is monotonic for the same reason every other read write
 * is.
 */
export async function advanceThreadCursor(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		rootCommentId: string;
		commentId: string;
		createdAt: Date;
	},
): Promise<void> {
	await upsertCursor(tx, tenant, input);
}

/** One monotonic cursor upsert. */
async function upsertCursor(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		rootCommentId: string;
		commentId: string;
		createdAt: Date;
	},
): Promise<void> {
	await tx
		.insert(commentThreadRead)
		.values({
			id: randomUUID(),
			organizationId: tenant.organizationId,
			projectId: input.projectId,
			milestoneId: input.milestoneId,
			rootCommentId: input.rootCommentId,
			userId: tenant.userId,
			lastReadAt: input.createdAt,
			lastReadCommentId: input.commentId,
		})
		.onConflictDoUpdate({
			target: [commentThreadRead.rootCommentId, commentThreadRead.userId],
			set: {
				lastReadAt: sql`excluded.last_read_at`,
				lastReadCommentId: sql`excluded.last_read_comment_id`,
				updatedAt: new Date(),
			},
			setWhere: sql`(${commentThreadRead.lastReadAt}, ${commentThreadRead.lastReadCommentId}) < (excluded.last_read_at, excluded.last_read_comment_id)`,
		});
}

/**
 * Unread count for one milestone.
 *
 * The read cursor is joined per comment through its thread root. A missing
 * cursor means everything after the baseline is unread. Deleted comments,
 * events and the viewer's own messages never count.
 */
export async function countMilestoneUnread(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	baselineAt: Date,
): Promise<number> {
	const cursorComment = alias(comment, "cursor_comment");

	const [row] = await tx
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(comment)
		.leftJoin(
			commentThreadRead,
			and(
				eq(
					commentThreadRead.rootCommentId,
					sql`coalesce(${comment.parentId}, ${comment.id})`,
				),
				eq(commentThreadRead.userId, tenant.userId),
			),
		)
		.leftJoin(
			cursorComment,
			eq(cursorComment.id, commentThreadRead.lastReadCommentId),
		)
		.where(
			and(
				eq(comment.organizationId, tenant.organizationId),
				eq(comment.milestoneId, milestoneId),
				eq(comment.kind, "comment"),
				isNull(comment.deletedAt),
				sql`${comment.authorId} is distinct from ${tenant.userId}`,
				sql`${comment.createdAt} > ${sql.param(baselineAt, comment.createdAt)}`,
				sql`(
					${commentThreadRead.id} is null
					or (${comment.createdAt}, ${comment.id}) > (${cursorComment.createdAt}, ${cursorComment.id})
				)`,
			),
		);

	return row?.count ?? 0;
}

/**
 * Unread counts grouped by milestone for one project.
 *
 * The route has already checked project access before calling this. One query
 * is enough for every badge in the workspace, so opening a project does not
 * become one count per milestone.
 */
export async function getProjectUnreadSummary(
	tenant: TenantContext,
	projectId: string,
): Promise<ProjectUnreadSummary> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProjectAccess(tx, tenant, projectId);
			const baselineAt = await loadUnreadBaseline(tx, tenant, projectId);
			const cursorComment = alias(comment, "cursor_comment");

			const rows = await tx
				.select({
					milestoneId: comment.milestoneId,
					count: sql<number>`count(*)`.mapWith(Number),
				})
				.from(comment)
				.innerJoin(milestone, eq(comment.milestoneId, milestone.id))
				.leftJoin(
					commentThreadRead,
					and(
						eq(
							commentThreadRead.rootCommentId,
							sql`coalesce(${comment.parentId}, ${comment.id})`,
						),
						eq(commentThreadRead.userId, tenant.userId),
					),
				)
				.leftJoin(
					cursorComment,
					eq(cursorComment.id, commentThreadRead.lastReadCommentId),
				)
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(milestone.projectId, access.projectId),
						eq(comment.kind, "comment"),
						isNull(comment.deletedAt),
						sql`${comment.authorId} is distinct from ${tenant.userId}`,
						sql`${comment.createdAt} > ${sql.param(baselineAt, comment.createdAt)}`,
						sql`(
							${commentThreadRead.id} is null
							or (${comment.createdAt}, ${comment.id}) > (${cursorComment.createdAt}, ${cursorComment.id})
						)`,
					),
				)
				.groupBy(comment.milestoneId);

			const milestones = rows.flatMap((row) =>
				row.milestoneId
					? [{ milestoneId: row.milestoneId, unread: row.count }]
					: [],
			);

			return {
				total: milestones.reduce((sum, item) => sum + item.unread, 0),
				milestones,
			};
		},
	);
}

/** Ask the project service for access without duplicating its rules. */
async function requireProjectAccess(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
): Promise<{ projectId: string }> {
	const access = await loadProjectAccess(tx, tenant, projectId);

	if (!access) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}

	return { projectId: access.row.id };
}

/**
 * Mark one or more comments read.
 *
 * The client sends the ids it actually saw. Each id is resolved to its thread
 * root, the newest id per root becomes the cursor, and the upsert can only move
 * forward. Notifications that point at comments up to the new cursor are
 * cleared in the same transaction, so the bell and the divider agree.
 */
export async function markCommentsRead(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentIds: string[],
): Promise<MarkCommentsReadResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await requireMilestoneAccess(tx, tenant, projectId, milestoneId);

			const uniqueIds = [...new Set(commentIds)];

			if (uniqueIds.length === 0) {
				return {
					unreadTotal: await countMilestoneUnread(
						tx,
						tenant,
						milestoneId,
						await loadUnreadBaseline(tx, tenant, projectId),
					),
					threads: [],
				};
			}

			// The database decides the newest row by `(created_at, id)`. Sorting
			// here keeps microsecond precision, which a JavaScript Date loses.
			const rows = await tx
				.select({
					id: comment.id,
					parentId: comment.parentId,
					createdAt: comment.createdAt,
				})
				.from(comment)
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						eq(comment.kind, "comment"),
						inArray(comment.id, uniqueIds),
					),
				)
				.orderBy(desc(comment.createdAt), desc(comment.id));

			/*
			 * An id can disappear between render and click, for example when a
			 * cascade removes it or two tabs race. Mark the ids that still exist
			 * and ignore the rest: one stale id must not fail the whole request
			 * and leave every other message unread.
			 */
			if (rows.length === 0) {
				return {
					unreadTotal: await countMilestoneUnread(
						tx,
						tenant,
						milestoneId,
						await loadUnreadBaseline(tx, tenant, projectId),
					),
					threads: [],
				};
			}

			const newestByRoot = new Map<string, { id: string; createdAt: Date }>();

			for (const row of rows) {
				const rootId = threadRootId(row.id, row.parentId);

				// Rows arrive newest first, so the first row for a root is its
				// newest message.
				if (!newestByRoot.has(rootId)) {
					newestByRoot.set(rootId, {
						id: row.id,
						createdAt: row.createdAt,
					});
				}
			}

			for (const [rootId, newest] of newestByRoot) {
				await upsertCursor(tx, tenant, {
					projectId,
					milestoneId,
					rootCommentId: rootId,
					commentId: newest.id,
					createdAt: newest.createdAt,
				});

				await clearCommentNotifications(
					tx,
					tenant,
					milestoneId,
					rootId,
					newest,
				);
			}

			const rootIds = [...newestByRoot.keys()];
			const comments = await tx
				.select({
					id: comment.id,
					parentId: comment.parentId,
					authorId: comment.authorId,
					kind: comment.kind,
					createdAt: comment.createdAt,
					deletedAt: comment.deletedAt,
				})
				.from(comment)
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						or(
							inArray(comment.id, rootIds),
							inArray(comment.parentId, rootIds),
						),
					),
				)
				.orderBy(asc(comment.createdAt), asc(comment.id));

			const cursors = await loadThreadReadCursors(tx, tenant, rootIds);
			const baselineAt = await loadUnreadBaseline(tx, tenant, projectId);

			const threads: ThreadReadResult[] = rootIds.map((rootId) => {
				const items = comments.filter(
					(item) => threadRootId(item.id, item.parentId) === rootId,
				);
				const cursor = cursors.get(rootId) ?? null;

				return {
					rootCommentId: rootId,
					unread: computeThreadUnread({
						comments: items,
						viewerId: tenant.userId,
						baselineAt,
						cursorId: cursor?.lastReadCommentId ?? null,
					}),
				};
			});

			return {
				unreadTotal: await countMilestoneUnread(
					tx,
					tenant,
					milestoneId,
					baselineAt,
				),
				threads,
			};
		},
	);
}

/** Clear the viewer's comment notifications up to one thread cursor. */
async function clearCommentNotifications(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	rootId: string,
	cursor: { id: string; createdAt: Date },
): Promise<void> {
	await tx
		.update(notification)
		.set({ readAt: new Date() })
		.from(comment)
		.where(
			and(
				eq(notification.commentId, comment.id),
				eq(notification.organizationId, tenant.organizationId),
				eq(notification.recipientUserId, tenant.userId),
				isNull(notification.readAt),
				inArray(notification.type, [...COMMENT_NOTIFICATION_TYPES]),
				eq(comment.milestoneId, milestoneId),
				sql`coalesce(${comment.parentId}, ${comment.id}) = ${rootId}`,
				/**
				 * Compare against the cursor comment inside Postgres.
				 *
				 * The cursor arrives as a JavaScript Date, which keeps
				 * milliseconds while the stored timestamp keeps microseconds.
				 * Passing the JS value back would place the cutoff a fraction
				 * before the actual comment and leave that comment's
				 * notification unread. The subquery uses the stored value.
				 */
				sql`(${comment.createdAt}, ${comment.id}) <= (
					select cursor_comment.created_at, cursor_comment.id
					from "comment" as cursor_comment
					where cursor_comment.id = ${cursor.id}
				)`,
			),
		);
}

/**
 * The newest unread info for one thread, used by the focused thread endpoint.
 *
 * The caller already loaded the thread rows in canonical order, so this is a
 * pure calculation followed by one cursor lookup.
 */
export async function threadUnreadState(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	rootId: string,
	comments: readonly ReadableComment[],
): Promise<CommentUnread> {
	const cursor = (await loadThreadReadCursors(tx, tenant, [rootId])).get(
		rootId,
	);

	return computeThreadUnread({
		comments,
		viewerId: tenant.userId,
		baselineAt: await loadUnreadBaseline(tx, tenant, projectId),
		cursorId: cursor?.lastReadCommentId ?? null,
	});
}
