/**
 * One comment thread.
 *
 * Why this file: opening a thread needs the root, its replies and the viewer's
 * unread state in one response. It is a separate read from the paged list.
 *
 * Used by: `routes/comments.ts`.
 */

import { APIError } from "better-auth/api";
import { and, asc, eq } from "drizzle-orm";
import { comment } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import {
	countMilestoneUnread,
	loadUnreadBaseline,
	threadUnreadState,
} from "../comment-read";
import { requireMilestoneAccess } from "../milestone";
import { loadCommentRecord, loadPeople, toCommentRow } from "./access";
import type { CommentThreadResult } from "./types";

/**
 * One complete thread, for the focused comment tab.
 *
 * Why a separate read: the list is paged by root, so a comment the reader opened
 * earlier may not be in the pages currently loaded. This endpoint always returns
 * the root and every reply, which is what a dedicated tab needs.
 */
export async function getMilestoneCommentThread(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentId: string,
): Promise<CommentThreadResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);
			const locked = access.row.archivedAt !== null;

			const root = await loadCommentRecord(tx, tenant, milestoneId, commentId);

			// A reply has no thread of its own. Answering 404 keeps the tab read
			// honest instead of showing a single reply out of context. A timeline
			// event has no discussion either.
			if (!root || root.parentId !== null || root.kind !== "comment") {
				throw new APIError("NOT_FOUND", {
					message: "That discussion no longer exists.",
				});
			}

			const replies = await tx
				.select()
				.from(comment)
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						eq(comment.parentId, commentId),
					),
				)
				.orderBy(asc(comment.createdAt), asc(comment.id));

			const [people, baselineAt] = await Promise.all([
				loadPeople([root, ...replies]),
				loadUnreadBaseline(tx, tenant, projectId),
			]);

			const unread = await threadUnreadState(
				tx,
				tenant,
				projectId,
				root.id,
				[root, ...replies].map((record) => ({
					id: record.id,
					authorId: record.authorId,
					kind: record.kind,
					createdAt: record.createdAt,
					deletedAt: record.deletedAt,
				})),
			);

			return {
				thread: {
					comment: toCommentRow(root, people, tenant.userId, locked),
					replies: replies.map((reply) =>
						toCommentRow(reply, people, tenant.userId, locked),
					),
					unread,
				},
				unreadTotal: await countMilestoneUnread(
					tx,
					tenant,
					milestoneId,
					baselineAt,
				),
			};
		},
	);
}
