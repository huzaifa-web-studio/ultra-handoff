/**
 * Comment deletion.
 *
 * Why this file: a soft delete has to clear the notification rows for every
 * recipient and drop attachment objects only when no live body still references
 * them. Keeping the delete and the object walk together makes that order
 * explicit.
 *
 * Used by: `routes/comments.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { assertCanModifyComment } from "../../auth/comment-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { comment } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { keyFromRichText } from "../../lib/storage";
import type { TenantContext } from "../../middleware/tenant";
import { countMilestoneUnread, loadUnreadBaseline } from "../comment-read";
import { requireMilestoneAccess } from "../milestone";
import { deleteCommentNotifications } from "../notification.service";
import { deleteObjectsBestEffort } from "../upload.service";
import {
	countComments,
	loadCommentRecord,
	loadCommentRecordForUpdate,
	loadPeople,
	toCommentRow,
} from "./access";
import type { CommentWriteResult } from "./types";

/**
 * Delete your own comment.
 *
 * Soft delete: the row stays so replies keep their thread and the record of who
 * spoke remains, while the body and its mirror are blanked so the content is
 * actually gone. Repeating the call is not allowed because the second one would
 * look like a successful edit of deleted content; the service answers 400 with
 * the same wording the UI shows.
 */
export async function deleteMilestoneComment(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentId: string,
): Promise<CommentWriteResult> {
	const { result, removedKeys } = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			assertProjectActive(access.row.archivedAt);

			const record = await loadCommentRecordForUpdate(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			if (record.kind !== "comment") {
				throw new APIError("BAD_REQUEST", {
					message: "Timeline events cannot be deleted.",
				});
			}

			assertCanModifyComment({
				viewerId: tenant.userId,
				authorId: record.authorId,
				deletedAt: record.deletedAt,
				locked: access.row.archivedAt !== null,
			});

			// Collect the attachments before the body is blanked. Nothing else
			// links a stored object to the comment, so this walk is the last
			// chance to know which objects belong to it.
			const removedKeys = keyFromRichText(record.body);

			await tx
				.update(comment)
				.set({
					deletedAt: new Date(),
					body: [],
					bodyText: "",
				})
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						eq(comment.id, commentId),
					),
				);

			const deleted = await loadCommentRecord(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!deleted) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			// The comment is gone, so its mention and reply notifications must
			// not keep an unread badge alive. The rows belong to many
			// recipients, so the cleanup runs through the definer function
			// inside the current workspace.
			await deleteCommentNotifications(tx, commentId);

			const people = await loadPeople([deleted]);
			const baselineAt = await loadUnreadBaseline(tx, tenant, projectId);

			return {
				result: {
					comment: toCommentRow(deleted, people, tenant.userId, false),
					total: await countComments(tx, tenant, milestoneId),
					unreadTotal: await countMilestoneUnread(
						tx,
						tenant,
						milestoneId,
						baselineAt,
					),
					notifications: [],
				},
				removedKeys,
			};
		},
	);

	// The rows are committed, so removing the bytes cannot roll the delete back.
	await deleteObjectsBestEffort(removedKeys);

	return result;
}
