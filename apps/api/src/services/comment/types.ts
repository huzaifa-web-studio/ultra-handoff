/**
 * Comment wire shapes.
 *
 * Why this file: the routes and every comment module name the same thread and
 * row shapes, so they live together.
 *
 * Used by: every module in `services/comment/` and `routes/comments.ts`.
 */

import type { comment } from "../../db/schema";
import type { MilestoneEventType } from "../../lib/milestone-events";
import type { CommentUnread } from "../comment-read";
import type { NotificationDelivery } from "../notification.service";

export type CommentAuthor = {
	id: string;
	name: string;
	image: string | null;
};

/** One field change recorded in the milestone timeline. */
export type CommentEventType = MilestoneEventType;

/** The stored change, ready to render as a sentence. */
export type CommentEvent = {
	type: CommentEventType;
	/** Null when the field was empty before the change. */
	from: string | null;
	/** Null when the field was cleared by the change. */
	to: string | null;
	/** Optional prose attached to the event, such as a lock or decline reason. */
	note: string | null;
};

/** One comment on the wire. */
export type CommentRow = {
	id: string;
	parentId: string | null;
	/** "event" rows are milestone activity, not messages. */
	kind: "comment" | "event";
	/** Present only on an event row. */
	event: CommentEvent | null;
	/** Empty for a deleted comment: the content is gone, the row is not. */
	body: unknown[];
	author: CommentAuthor | null;
	createdAt: string;
	/** Changes on an edit or a checklist toggle, so a static body can refresh. */
	updatedAt: string;
	editedAt: string | null;
	deletedAt: string | null;
	/** True when this caller is the author and the comment is still editable. */
	canEdit: boolean;
	/** Same rule as edit. Kept separate so a future moderator rule is one edit. */
	canDelete: boolean;
};

/** A root comment and its replies, in display order. */
export type CommentThread = {
	comment: CommentRow;
	replies: CommentRow[];
	/** The viewer's cursor state for this thread. */
	unread: CommentUnread;
};

/** One page of discussion. */
export type CommentListResult = {
	threads: CommentThread[];
	/** Non-deleted comments in the whole milestone, for the tab badge. */
	total: number;
	/** Unread messages in the whole milestone, for the unread badge. */
	unreadTotal: number;
	/** Opaque cursor for the next older page, or null at the end. */
	nextCursor: string | null;
};

/** One complete thread, used by the focused comment tab. */
export type CommentThreadResult = {
	thread: CommentThread;
	unreadTotal: number;
};

/** The write result every create and delete returns. */
export type CommentWriteResult = {
	comment: CommentRow;
	total: number;
	unreadTotal: number;
	/** Transport metadata, stripped by the route. */
	notifications: NotificationDelivery[];
};

/** The edit result. The count cannot change on an edit. */
export type CommentEditResult = {
	comment: CommentRow;
	/** Mentions added by the edit, as transport metadata. */
	notifications: NotificationDelivery[];
};

/**
 * Longest a comment post may wait on the throttle.
 *
 * The limiter is a safety net, not a dependency. A Redis outage must not make
 * posting a comment hang, so the check is raced against a short timer that
 * answers "allowed". This mirrors the fail open behaviour of the underlying
 * helper, but bounded in time as well as in outcome.
 */

export type CommentRecord = typeof comment.$inferSelect;

/** Normalised list input, already clamped by the route. */
export type CommentListQuery = {
	cursor: string | null;
	limit: number;
};

/** Public create input. */
export type CreateCommentInput = {
	body: unknown;
	parentId?: string | null;
};
