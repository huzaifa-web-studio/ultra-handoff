/**
 * New comments.
 *
 * Why this file: posting a comment resolves the parent, checks the rate gate,
 * writes the mention notifications and advances the thread cursor in one
 * transaction. Those steps belong together.
 *
 * Used by: `routes/comments.ts`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";

import { assertCanComment } from "../../auth/comment-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { comment } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { collectMentionKeys } from "../../lib/mentions";
import { sanitizeCommentBody } from "../../lib/rich-text";
import type { TenantContext } from "../../middleware/tenant";
import {
	advanceThreadCursor,
	countMilestoneUnread,
	loadUnreadBaseline,
	threadRootId,
} from "../comment-read.service";
import { assertCommentMentions } from "../mention.service";
import { requireMilestoneAccess } from "../milestone";
import {
	createNotifications,
	loadMilestoneAssigneeUserIds,
	loadProjectMemberUserIds,
} from "../notification.service";
import { loadUserMap } from "../project";
import {
	allowCommentRate,
	countComments,
	loadCommentRecord,
	toCommentRow,
} from "./access";
import type { CommentWriteResult, CreateCommentInput } from "./types";

/**
 * Post a comment or a reply.
 *
 * The rate limit runs before the transaction so a rejected request never holds
 * a transaction open. It fails open, like every other throttle in the app.
 */
export async function createMilestoneComment(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	input: CreateCommentInput,
): Promise<CommentWriteResult> {
	const body = sanitizeCommentBody(input.body);
	const parentId = input.parentId?.trim() || null;

	const allowed = await allowCommentRate(tenant, milestoneId);

	if (!allowed) {
		throw new APIError("TOO_MANY_REQUESTS", {
			message: "You are posting too quickly. Wait a minute and try again.",
		});
	}

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
			assertCanComment(tenant.role, access.role);

			let parentAuthorId: string | null = null;

			if (parentId) {
				const parent = await loadCommentRecord(
					tx,
					tenant,
					milestoneId,
					parentId,
				);

				if (!parent) {
					throw new APIError("NOT_FOUND", {
						message: "The comment you replied to no longer exists.",
					});
				}

				if (parent.deletedAt !== null) {
					throw new APIError("BAD_REQUEST", {
						message: "You cannot reply to a deleted comment.",
					});
				}

				if (parent.kind !== "comment") {
					throw new APIError("BAD_REQUEST", {
						message: "You cannot reply to a timeline event.",
					});
				}

				if (parent.parentId !== null) {
					throw new APIError("BAD_REQUEST", {
						message:
							"Replies are one level deep. Reply to the first comment instead.",
					});
				}

				parentAuthorId = parent.authorId;
			}

			const commentId = randomUUID();

			// Mentions are checked inside the same transaction as the insert, so
			// a project, milestone or person cannot be removed between the check
			// and the stored body.
			await assertCommentMentions(tx, tenant, projectId, body.value);

			await tx.insert(comment).values({
				id: commentId,
				organizationId: tenant.organizationId,
				milestoneId,
				parentId,
				authorId: tenant.userId,
				body: body.value,
				bodyText: body.text,
			});

			const record = await loadCommentRecord(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That comment could not be read back.",
				});
			}

			const people = await loadUserMap([tenant.userId]);

			// The author's own message can never be unread to them.
			await advanceThreadCursor(tx, tenant, {
				projectId,
				milestoneId,
				rootCommentId: threadRootId(commentId, parentId),
				commentId,
				createdAt: record.createdAt,
			});

			const projectView = {
				id: access.row.id,
				name: access.row.name,
				slug: access.row.slug,
			};
			const milestoneView = {
				id: milestone.id,
				title: milestone.title,
			};
			const commentView = {
				id: commentId,
				parentId,
				preview: body.text,
			};
			const noticeByUser = new Map<
				string,
				"mention" | "comment_reply" | "comment_new"
			>();

			// Mentions are the strongest signal. A person who is both mentioned
			// and replied to gets one row, not two.
			for (const mention of collectMentionKeys(body.value)) {
				if (mention.type === "user") {
					noticeByUser.set(mention.id, "mention");
				}
			}

			if (parentAuthorId && !noticeByUser.has(parentAuthorId)) {
				noticeByUser.set(parentAuthorId, "comment_reply");
			}

			if (!parentId) {
				const [assignees, clients] = await Promise.all([
					loadMilestoneAssigneeUserIds(tx, tenant, milestoneId),
					loadProjectMemberUserIds(tx, tenant, projectId, ["client"]),
				]);

				for (const userId of [...assignees, ...clients]) {
					if (!noticeByUser.has(userId)) {
						noticeByUser.set(userId, "comment_new");
					}
				}
			}

			const candidates = [...noticeByUser.entries()]
				.filter(([userId]) => userId !== tenant.userId)
				.map(([recipientUserId, type]) => ({
					recipientUserId,
					actorUserId: tenant.userId,
					type,
					dedupeKey:
						type === "mention"
							? `mention:comment:${commentId}:${recipientUserId}`
							: type === "comment_reply"
								? `reply:comment:${commentId}:${recipientUserId}`
								: `comment:${commentId}:${recipientUserId}`,
					project: projectView,
					milestone: milestoneView,
					comment: commentView,
				}));

			const notifications = await createNotifications(tx, tenant, candidates);
			const baselineAt = await loadUnreadBaseline(tx, tenant, projectId);

			return {
				comment: toCommentRow(record, people, tenant.userId, false),
				total: await countComments(tx, tenant, milestoneId),
				unreadTotal: await countMilestoneUnread(
					tx,
					tenant,
					milestoneId,
					baselineAt,
				),
				notifications,
			};
		},
	);
}
