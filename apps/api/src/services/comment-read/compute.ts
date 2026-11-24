/**
 * In-memory thread unread calculation.
 *
 * Why this file: a loaded page of comments needs to know where the first unread
 * message is without a second query. The calculation never compares timestamps
 * in JavaScript for the cursor, only for the fallback.
 *
 * Used by: `services/comment/` and the comment routes.
 */

/**
 * Compute unread state for one thread from an ordered list.
 *
 * The cursor is matched by id, not by timestamp. Postgres stores microseconds
 * while JavaScript keeps milliseconds, so comparing Date objects for two
 * comments in the same millisecond could put the divider in the wrong place.
 * The rows arrive ordered by `(created_at, id)`, which is the canonical order,
 * so the cursor's position in that list is exact.
 */

import type { CommentUnread, ReadableComment } from "./types";
export function computeThreadUnread(input: {
	comments: readonly ReadableComment[];
	viewerId: string;
	baselineAt: Date;
	cursorId: string | null;
}): CommentUnread {
	// Match the SQL order exactly. The cursor is a tuple of
	// `(created_at, id)`, so finding it in an array that only follows the UI's
	// root-first order could put a tied reply on the wrong side of the cursor.
	const ordered = [...input.comments].sort((left, right) => {
		const time = left.createdAt.getTime() - right.createdAt.getTime();

		return time !== 0 ? time : left.id.localeCompare(right.id);
	});
	const cursorIndex = input.cursorId
		? ordered.findIndex((item) => item.id === input.cursorId)
		: -1;
	const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
	let count = 0;
	let firstUnreadCommentId: string | null = null;

	for (const item of ordered.slice(start)) {
		// A cursor older than the membership baseline cannot happen through the
		// UI, but a data repair could produce it. The baseline still wins.
		if (cursorIndex < 0 && item.createdAt <= input.baselineAt) continue;
		if (item.kind !== "comment") continue;
		if (item.deletedAt !== null) continue;
		if (item.authorId === input.viewerId) continue;

		count += 1;

		if (firstUnreadCommentId === null) firstUnreadCommentId = item.id;
	}

	return { count, firstUnreadCommentId };
}
