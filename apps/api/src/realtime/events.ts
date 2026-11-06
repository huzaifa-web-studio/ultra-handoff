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
