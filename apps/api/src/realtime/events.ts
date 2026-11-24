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

import type { ChangeRequestRow } from "../services/change-request.service";
import type { CommentRow } from "../services/comment.service";
import type { MilestoneSummary } from "../services/milestone";
import type { NotificationDelivery } from "../services/notification.service";

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
	| "assignees"
	| "lock"
	| "checklist";

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
 * A scope section changed.
 *
 * Ids only. The body stays on the authenticated read endpoint, so a large test
 * or review round never travels through Redis and every socket.
 */
export type MilestoneScopeChangedPayload = {
	milestoneId: string;
	entryId: string;
	/** The author, so the writer's own tab can ignore its echo. */
	updatedBy: string;
};

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
		status: milestone.status,
		startDate: milestone.startDate,
		dueDate: milestone.dueDate,
		estimateMinutes: milestone.estimateMinutes,
		assignees: milestone.assignees,
		lockedAt: milestone.lockedAt,
		lockedByName: milestone.lockedByName,
		openChangeRequestCount: milestone.openChangeRequestCount,
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
 * Strip the viewer specific capabilities from a change request.
 *
 * Same rule as a comment: `canEdit` and `canWithdraw` are answers for the
 * writer, so broadcasting them would tell every reader they may change a
 * request that is not theirs. The browser recomputes both for its viewer.
 */
export function toRealtimeChangeRequest(
	changeRequest: ChangeRequestRow,
): RealtimeChangeRequest {
	return {
		id: changeRequest.id,
		projectId: changeRequest.projectId,
		milestoneId: changeRequest.milestoneId,
		title: changeRequest.title,
		body: changeRequest.body,
		status: changeRequest.status,
		requestedBy: changeRequest.requestedBy,
		decidedBy: changeRequest.decidedBy,
		decidedAt: changeRequest.decidedAt,
		decisionNote: changeRequest.decisionNote,
		targetMilestoneId: changeRequest.targetMilestoneId,
		targetMilestoneTitle: changeRequest.targetMilestoneTitle,
		scopeEntryId: changeRequest.scopeEntryId,
		createdAt: changeRequest.createdAt,
		updatedAt: changeRequest.updatedAt,
	};
}

/**
 * One personal notification.
 *
 * The payload is the rendered delivery, not the raw row: the browser can show
 * an operating system alert immediately and does not need to fetch the row
 * first. The stored row remains the source of truth for the list.
 */
export type NotificationCreatedPayload = NotificationDelivery;

/** A read action, so the same person's other tabs update their badge. */
export type NotificationReadPayload = { unread: number };

/** A discussion cursor moved, so another tab refreshes its unread state. */
export type CommentReadPayload = {
	projectId: string;
	milestoneId: string;
	rootCommentIds: string[];
	unreadTotal: number;
};

/** A change request as it travels over the stream. */
export type RealtimeChangeRequest = Omit<
	ChangeRequestRow,
	"canEdit" | "canWithdraw"
>;

/** One change request event. `openCount` feeds the tab badge. */
export type ChangeRequestRealtimePayload = {
	milestoneId: string;
	changeRequest: RealtimeChangeRequest;
	openCount: number;
};

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
