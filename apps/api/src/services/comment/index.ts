/**
 * Public surface of the comment module.
 *
 * Why: routes and sibling services should import one entry point instead of
 * reaching into individual files. Every name the old `comment/`
 * exported is re-exported here.
 *
 * Used by: `routes/comments.ts`, the realtime events and the integration
 * suites.
 */

export {
	type CommentChecklistResult,
	type ToggleChecklistInput,
	toggleMilestoneChecklistItem,
} from "./checklist";
export { createMilestoneComment } from "./create";
export { deleteMilestoneComment } from "./delete";
export { listMilestoneComments } from "./list";
export type { CommentSearchResult, CommentSearchRow } from "./search";
export { searchMilestoneComments } from "./search";
export { getMilestoneCommentThread } from "./thread";
export type {
	CommentAuthor,
	CommentEditResult,
	CommentEvent,
	CommentEventType,
	CommentListQuery,
	CommentListResult,
	CommentRow,
	CommentThread,
	CommentThreadResult,
	CommentWriteResult,
	CreateCommentInput,
} from "./types";
export { updateMilestoneComment } from "./update";
