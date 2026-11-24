/**
 * Comment edits.
 *
 * Why this file: an edit can add or remove mentions, so it has to reconcile the
 * notification rows as well as the body. Keeping that reconciliation with the
 * edit is what stops a stale bell row.
 *
 * Used by: `routes/comments.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { assertCanModifyComment } from "../../auth/comment-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { comment } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { sanitizeCommentBody } from "../../lib/rich-text";
import type { TenantContext } from "../../middleware/tenant";
import { assertCommentMentions } from "../mention.service";
import { requireMilestoneAccess } from "../milestone";
import {
	createNotifications,
	deleteNotificationsForRecipient,
} from "../notification.service";
import {
	loadCommentRecord,
	loadCommentRecordForUpdate,
	loadPeople,
	toCommentRow,
} from "./access";
import { mentionedUserIds } from "./mentions";
import type { CommentEditResult } from "./types";

/** Change the body of your own comment. */
export async function updateMilestoneComment(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentId: string,
	input: { body: unknown },
): Promise<CommentEditResult> {
	const body = sanitizeCommentBody(input.body);

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access, milestone } = await requireMilestoneAccess(
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
					message: "Timeline events cannot be edited.",
				});
			}

			assertCanModifyComment({
				viewerId: tenant.userId,
				authorId: record.authorId,
				deletedAt: record.deletedAt,
				locked: access.row.archivedAt !== null,
			});

			// An edit can add or remove mentions, so the same guard runs again.
			await assertCommentMentions(tx, tenant, projectId, body.value);

			const beforeMentions = mentionedUserIds(record.body);
			const afterMentions = mentionedUserIds(body.value);
			const addedMentions = [...afterMentions].filter(
				(userId) => !beforeMentions.has(userId),
			);
			const removedMentions = [...beforeMentions].filter(
				(userId) => !afterMentions.has(userId),
			);

			await tx
				.update(comment)
				.set({
					body: body.value,
					bodyText: body.text,
					editedAt: new Date(),
				})
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						eq(comment.id, commentId),
					),
				);

			// A mention removed by an edit must not keep an unread bell. The
			// recipients are known, so the delete is scoped to each of them,
			// exactly like the insert below. The actor cannot read the row and
			// does not need to: only the recipient can delete it, and the
			// transaction is temporarily scoped to them for that statement.
			for (const userId of removedMentions) {
				await deleteNotificationsForRecipient(tx, tenant, userId, [
					`mention:comment:${commentId}:${userId}`,
				]);
			}

			const updated = await loadCommentRecord(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!updated) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			const people = await loadPeople([updated]);
			const notifications =
				addedMentions.length > 0
					? await createNotifications(
							tx,
							tenant,
							addedMentions
								.filter((userId) => userId !== tenant.userId)
								.map((userId) => ({
									recipientUserId: userId,
									actorUserId: tenant.userId,
									type: "mention" as const,
									dedupeKey: `mention:comment:${commentId}:${userId}`,
									project: {
										id: access.row.id,
										name: access.row.name,
										slug: access.row.slug,
									},
									milestone: {
										id: milestone.id,
										title: milestone.title,
									},
									comment: {
										id: commentId,
										parentId: updated.parentId,
										preview: body.text,
									},
								})),
						)
					: [];

			return {
				comment: toCommentRow(updated, people, tenant.userId, false),
				notifications,
			};
		},
	);
}
