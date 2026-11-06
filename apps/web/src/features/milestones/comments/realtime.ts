"use client";

/**
 * Realtime wiring for milestone comments.
 *
 * Why one hook at the panel level: every comment surface for the open milestone
 * (the main list, each focused thread tab, and a thread that was opened earlier)
 * reads the same queries. One subscription patches all of them, so a comment
 * posted in another tab or by another person lands everywhere without a refetch.
 *
 * Viewer rule: the server broadcasts a viewer neutral comment, because
 * `canEdit` and `canDelete` are answers for the writer. They are recomputed here
 * for the signed in viewer, so a reader never sees an action the API would
 * refuse.
 *
 * Used by: milestone-detail-panel.tsx (cache updates) and comment-tab.tsx
 * (scroll and announcement behaviour).
 */

import type {
	CommentRealtimePayload,
	RealtimeComment,
	RealtimeEnvelope,
} from "@org/api";
import { useQueryClient } from "@tanstack/react-query";

import { useRealtimeEvent } from "#/features/realtime/provider";
import type { Comment } from "./api";
import { applyCommentEvent } from "./hooks";

/** Recompute the two capabilities the server strips before broadcasting. */
export function toViewerComment(
	comment: RealtimeComment,
	viewerId: string,
	locked: boolean,
): Comment {
	const editable =
		comment.kind === "comment" &&
		comment.deletedAt === null &&
		!locked &&
		comment.author?.id === viewerId;

	return { ...comment, canEdit: editable, canDelete: editable };
}

/**
 * Validate one event and return its comment payload.
 *
 * Redis and the network are outside TypeScript, so a frame is checked before
 * its body reaches a reducer. Anything that is not a comment event, or does not
 * carry the fields a cache patch needs, is ignored.
 */
export function readCommentPayload(
	event: RealtimeEnvelope,
): CommentRealtimePayload | null {
	if (
		event.type !== "comment.created" &&
		event.type !== "comment.updated" &&
		event.type !== "comment.deleted"
	) {
		return null;
	}

	const data = event.data;

	if (!data || typeof data !== "object" || Array.isArray(data)) return null;

	const record = data as Record<string, unknown>;
	const milestoneId = record.milestoneId;
	const total = record.total;
	const comment = record.comment;

	if (typeof milestoneId !== "string") return null;
	if (total !== null && typeof total !== "number") return null;
	if (!comment || typeof comment !== "object" || Array.isArray(comment)) {
		return null;
	}

	const candidate = comment as Record<string, unknown>;

	if (typeof candidate.id !== "string") return null;
	if (typeof candidate.createdAt !== "string") return null;

	return {
		milestoneId,
		comment: comment as RealtimeComment,
		total: total as number | null,
	};
}

/** Map an event name to the cache operation it performs. */
function toKind(
	type: RealtimeEnvelope["type"],
): "created" | "updated" | "deleted" | null {
	if (type === "comment.created") return "created";
	if (type === "comment.deleted") return "deleted";
	if (type === "comment.updated") return "updated";

	return null;
}

/**
 * Keep the comment caches of one open milestone in sync.
 *
 * A comment event for another milestone is ignored: the socket is project
 * scoped, and the detail pane only ever shows one milestone at a time.
 */
export function useRealtimeComments({
	orgSlug,
	projectId,
	milestoneId,
	viewerId,
	locked,
}: {
	orgSlug: string;
	projectId: string;
	milestoneId: string;
	viewerId: string;
	locked: boolean;
}): void {
	const queryClient = useQueryClient();

	useRealtimeEvent((event) => {
		const kind = toKind(event.type);

		if (!kind) return;

		const payload = readCommentPayload(event);

		if (!payload || payload.milestoneId !== milestoneId) return;

		applyCommentEvent(
			queryClient,
			orgSlug,
			projectId,
			{
				milestoneId,
				comment: toViewerComment(payload.comment, viewerId, locked),
				total: payload.total,
			},
			kind,
		);
	});
}
