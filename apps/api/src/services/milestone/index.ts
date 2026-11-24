/**
 * Public surface of the milestone module.
 *
 * Why: routes and sibling services should import one entry point instead of
 * reaching into individual files. That keeps the internal layout free to move
 * and matches the folder modules already used by storage, realtime and queues.
 *
 * Every name the old `milestone.service.ts` exported is re-exported here, so
 * callers only change their import path.
 *
 * Used by: `routes/milestones.ts`, `routes/change-requests.ts`,
 * `change-request.service.ts`, `comment.service.ts`, `comment-read.service.ts`,
 * the realtime gateway and the integration suites.
 */

export {
	milestoneExistsInProject,
	requireMilestoneAccess,
} from "./access";
export { toggleMilestoneChecklist } from "./checklist";
export { createMilestone, insertMilestone } from "./create";
export { deleteMilestone } from "./delete";
export { getMilestone, listMilestones } from "./list";
export { lockMilestone, unlockMilestone } from "./lock";
export { setMilestoneAssignees } from "./set-assignees";
export { recordMilestoneEvents, toMilestoneTimeline } from "./timeline";
export type {
	CommentRecord,
	CreateMilestoneInput,
	MilestoneAssigneeRow,
	MilestoneCounts,
	MilestoneDetail,
	MilestoneDetailResult,
	MilestoneListQuery,
	MilestoneListResult,
	MilestoneRecord,
	MilestoneSummary,
	MilestoneTimelineComment,
	MilestoneUpdateResult,
	MilestoneViewer,
	MilestoneWriteResult,
	ToggleMilestoneChecklistInput,
	UpdateMilestoneInput,
} from "./types";
export { updateMilestone } from "./update";
