/**
 * Milestone status colours.
 *
 * Why a module: the same five states appear in the list row, the detail header,
 * the status select and the filter. Keeping the class map in one place means a
 * new status, or a shade change in `global.css`, only touches this file.
 *
 * The colours come from the `--milestone-*` tokens in the shared stylesheet, so
 * there are no raw hex values in any component.
 *
 * Used by: milestone-status-badge.tsx, milestone-status-select.tsx,
 * milestone-list-panel.tsx.
 */

import type { MilestoneStatus, MilestoneStatusFilter } from "./schema";

/** Text colour only, for places that already have their own surface. */
export const MILESTONE_STATUS_TEXT_CLASSES: Record<MilestoneStatus, string> = {
	todo: "text-milestone-todo",
	in_progress: "text-milestone-in-progress",
	blocked: "text-milestone-blocked",
	done: "text-milestone-done",
	cancelled: "text-milestone-cancelled",
};

/** Text plus the matching tinted background, for the badge. */
export const MILESTONE_STATUS_BADGE_CLASSES: Record<MilestoneStatus, string> = {
	todo: "bg-milestone-todo-bg text-milestone-todo",
	in_progress: "bg-milestone-in-progress-bg text-milestone-in-progress",
	blocked: "bg-milestone-blocked-bg text-milestone-blocked",
	done: "bg-milestone-done-bg text-milestone-done",
	cancelled: "bg-milestone-cancelled-bg text-milestone-cancelled line-through",
};

/**
 * Text colour for a filter value.
 *
 * "All" and "Active" are not statuses, so they keep the default text colour.
 */
export function milestoneStatusTextClass(value: MilestoneStatusFilter): string {
	if (value === "all" || value === "active") return "";

	return MILESTONE_STATUS_TEXT_CLASSES[value];
}
