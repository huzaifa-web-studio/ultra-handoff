/**
 * Public surface of the milestone hooks.
 *
 * Why: components should import one entry point instead of reaching into the
 * query, sync or mutation files. Every name the old `hooks.ts` exported is
 * re-exported here.
 *
 * Used by: every component in `features/milestones/`.
 */

export {
	milestoneDetailKey,
	milestonesKey,
} from "./keys";
export {
	useCreateMilestone,
	useDeleteMilestone,
	useSetMilestoneAssignees,
	useSetMilestoneLock,
	useSetMilestoneStatus,
	useToggleMilestoneChecklist,
	useUpdateMilestone,
} from "./mutations";
export { useMilestoneDetail, useMilestones } from "./reads";
export {
	milestoneScopeEntryKey,
	useMilestoneScopeEntry,
	useUpdateMilestoneScopeEntry,
} from "./scope";
export { applyMilestoneEvent, type MilestoneRealtimeEvent } from "./sync";
