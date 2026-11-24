/**
 * Marking comments read.
 *
 * Why this file: marking one thread or the whole milestone read moves the same
 * monotonic cursor and clears the same comment notifications. Keeping both
 * writes together makes the cutoff semantics explicit.
 *
 * Used by: `routes/comments.ts`.
 */

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { comment } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { requireMilestoneAccess } from "../milestone";
import {
	loadThreadReadCursors,
	loadUnreadBaseline,
	threadRootId,
	upsertCursor,
} from "./baseline";
import { clearCommentNotifications } from "./clear";
import { computeThreadUnread } from "./compute";
import { countMilestoneUnread } from "./count";
import type { MarkCommentsReadResult, ThreadReadResult } from "./types";

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
