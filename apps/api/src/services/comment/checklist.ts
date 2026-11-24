/**
 * Comment checklist ticks.
 *
 * Why this file: a checklist item lives inside a comment body, so a tick is a
 * read-modify-write on the comment row. It shares the comment access rules but
 * has no timeline or notification side effects.
 *
 * Used by: `routes/comments.ts`.
 */

import { APIError } from "better-auth/api";

import {
	assertCanComment,
	assertCanModifyComment,
} from "../../auth/comment-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { comment } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { findChecklistItem } from "../../lib/checklist";
import type { TenantContext } from "../../middleware/tenant";
import { requireMilestoneAccess } from "../milestone";
import {
	commentScope,
	loadCommentRecordForUpdate,
	loadPeople,
	toCommentRow,
} from "./access";
import type { CommentRow } from "./types";

/** The toggled comment, ready for the list and thread caches. */
export type CommentChecklistResult = {
	comment: CommentRow;
};

/** One checklist item change. */
export type ToggleChecklistInput = {
	itemId: string;
	checked: boolean;
};

/**
 * Flip one checklist item.
 *
 * Author only, matching the rule for editing the comment text: a checklist is
 * part of the body, and the product rule is that only its author changes it.
 * The comment text is untouched, the edited marker does not move, and the row
 * lock keeps the author's two tabs from dropping each other's change.
 */
export async function toggleMilestoneChecklistItem(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentId: string,
	input: ToggleChecklistInput,
): Promise<CommentChecklistResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			assertProjectActive(access.row.archivedAt);
			assertCanComment(tenant.role, access.role);

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
					message: "Timeline events do not have a checklist.",
				});
			}

			if (record.deletedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "That comment was deleted and can no longer be changed.",
				});
			}

			// A checklist item lives inside the comment body, so a toggle is a
			// comment change. Using the author rule keeps the write honest and
			// avoids a silent edit with no attribution.
			assertCanModifyComment({
				viewerId: tenant.userId,
				authorId: record.authorId,
				deletedAt: record.deletedAt,
				locked: access.row.archivedAt !== null,
			});

			const body = structuredClone(record.body);
			const item = findChecklistItem(body, input.itemId);

			if (!item) {
				throw new APIError("NOT_FOUND", {
					message: "That checklist item no longer exists.",
				});
			}

			// A tap that matches the stored state is a no-op. Returning the row
			// without an update keeps `updatedAt` and the static body stable.
			if (item.checked === input.checked) {
				const people = await loadPeople([record]);

				return {
					comment: toCommentRow(record, people, tenant.userId, false),
				};
			}

			item.checked = input.checked;

			const [updated] = await tx
				.update(comment)
				.set({ body })
				.where(commentScope(tenant, milestoneId, commentId))
				.returning();

			if (!updated) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			const people = await loadPeople([updated]);

			return {
				comment: toCommentRow(updated, people, tenant.userId, false),
			};
		},
	);
}
