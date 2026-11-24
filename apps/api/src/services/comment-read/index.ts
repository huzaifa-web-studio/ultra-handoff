/**
 * Public surface of the comment read module.
 *
 * Why: the comment service, the milestone service and the routes should import
 * one entry point. Every name the old `comment-read/` exported is
 * re-exported here.
 *
 * Used by: `services/comment/`, `services/milestone/` and the comment routes.
 */

export {
	advanceThreadCursor,
	loadThreadReadCursors,
	loadUnreadBaseline,
	threadRootId,
} from "./baseline";
export { computeThreadUnread } from "./compute";
export {
	countMilestoneUnread,
	getProjectUnreadSummary,
} from "./count";
export { markCommentsRead } from "./mark";
export { threadUnreadState } from "./state";
export type {
	CommentUnread,
	MarkCommentsReadResult,
	MilestoneUnreadResult,
	ProjectUnreadSummary,
	ReadableComment,
	ThreadReadCursor,
	ThreadReadResult,
} from "./types";
