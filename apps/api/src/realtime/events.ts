/**
 * Realtime event payloads.
 *
 * Why a separate module from `protocol.ts`: the protocol owns the envelope and
 * the event names, which both apps share as types. The payload bodies belong to
 * one feature and may import that feature's types. Keeping them apart means a
 * new feature adds a payload here without touching the transport contract.
 *
 * Viewer rule: a broadcast comment is deliberately viewer neutral. `canEdit`
 * and `canDelete` are computed for the writer by the service, so sending them
 * would tell every reader they may edit someone else's comment. They are
 * stripped here and recomputed by the client for its own viewer.
 *
 * Used by: routes/comments.ts (publishing) and the type re-export in
 * src/index.ts (which the web app imports as a type only).
 */

import type { CommentRow } from "../services/comment.service";
import type { MilestoneSummary } from "../services/milestone.service";

/** A comment as it travels over the stream, without viewer capabilities. */
export type RealtimeComment = Omit<CommentRow, "canEdit" | "canDelete">;

/** One comment event. `total` is null when the count cannot change. */
export type CommentRealtimePayload = {
	milestoneId: string;
	comment: RealtimeComment;
	/** New visible comment count on create and delete, otherwise null. */
	total: number | null;
};

/**
 * The milestone fields an update actually changed.
 *
 * Why the list matters: the client patches a row in place for a title or date
 * edit, but a status change can move the row out of the current filter and
 * changes the counts, so only that case forces a list refetch.
 */
export type MilestoneChangedField =
	| "title"
	| "description"
	| "status"
	| "startDate"
	| "dueDate"
	| "estimateMinutes"
	| "assignees";

/**
 * The milestone a create or update broadcasts.
 *
 * Deliberately a `MilestoneSummary`, not a `MilestoneDetail`: the rich text body
 * is large and editing it live is postponed, so the client merges the summary
 * into its detail cache and keeps the body it already has.
 */
export type MilestoneCreatedPayload = { milestone: MilestoneSummary };

export type MilestoneUpdatedPayload = {
	milestone: MilestoneSummary;
	changed: MilestoneChangedField[];
};

export type MilestoneDeletedPayload = { milestoneId: string };

/**
 * Keep only the summary fields of a milestone.
 *
 * Why explicit: a create returns a `MilestoneDetail`, which is a summary plus
 * the rich text body. Assigning it to a `MilestoneSummary` type is allowed by
 * TypeScript but still ships the body at runtime. A mapped object is the only
 * way to guarantee the body never leaves the server on this channel.
 */
export function toRealtimeMilestone(
	milestone: MilestoneSummary,
): MilestoneSummary {
	return {
		id: milestone.id,
		projectId: milestone.projectId,
		title: milestone.title,
		excerpt: milestone.excerpt,
		status: milestone.status,
		startDate: milestone.startDate,
		dueDate: milestone.dueDate,
		estimateMinutes: milestone.estimateMinutes,
		assignees: milestone.assignees,
		completedAt: milestone.completedAt,
		createdBy: milestone.createdBy,
		createdByName: milestone.createdByName,
		updatedBy: milestone.updatedBy,
		updatedByName: milestone.updatedByName,
		createdAt: milestone.createdAt,
		updatedAt: milestone.updatedAt,
	};
}

/**
 * Strip the viewer specific capabilities from a comment.
 *
 * Explicit field list rather than a rest spread with unused variables, so a
 * field added to `CommentRow` later is a deliberate decision here instead of
 * being broadcast by accident.
 */
export function toRealtimeComment(comment: CommentRow): RealtimeComment {
	return {
		id: comment.id,
		parentId: comment.parentId,
		kind: comment.kind,
		event: comment.event,
		body: comment.body,
		author: comment.author,
		createdAt: comment.createdAt,
		updatedAt: comment.updatedAt,
		editedAt: comment.editedAt,
		deletedAt: comment.deletedAt,
	};
}
