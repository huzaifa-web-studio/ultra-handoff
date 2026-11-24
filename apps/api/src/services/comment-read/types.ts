/**
 * Message read state shapes.
 *
 * Why this file: the comment service, the milestone service and the routes all
 * name the same read state and unread shapes, so they live together.
 *
 * Used by: the modules in `services/comment-read/`.
 */

/** The unread state of one thread. */
export type CommentUnread = {
	count: number;
	/** The oldest message the viewer has not read, or null when caught up. */
	firstUnreadCommentId: string | null;
};

/** A stored cursor for one thread root. */
export type ThreadReadCursor = {
	lastReadAt: Date;
	lastReadCommentId: string;
};

/** The minimum comment shape the in-memory calculation needs. */
export type ReadableComment = {
	id: string;
	authorId: string | null;
	kind: string;
	createdAt: Date;
	deletedAt: Date | null;
};

/** One thread's refreshed state after a mark request. */
export type ThreadReadResult = {
	rootCommentId: string;
	unread: CommentUnread;
};

/** The response of one mark request. */
export type MarkCommentsReadResult = {
	unreadTotal: number;
	threads: ThreadReadResult[];
};

/** One milestone's unread count, used by the project summary. */
export type MilestoneUnreadResult = {
	milestoneId: string;
	unread: number;
};

/** Project level unread summary for the workspace badges. */
export type ProjectUnreadSummary = {
	total: number;
	milestones: MilestoneUnreadResult[];
};
