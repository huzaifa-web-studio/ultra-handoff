/**
 * Milestone status colours and icons.
 *
 * Why a module: the same five states appear in the list row, the detail header,
 * the status select and the filter. Keeping the class and icon maps in one place
 * means a new status, or a shade change in `global.css`, only touches this file.
 *
 * The colours come from the `--milestone-*` tokens in the shared stylesheet, so
 * there are no raw hex values in any component.
 *
 * Used by: milestone-status-badge.tsx, milestone-status-select.tsx,
 * milestone-list-panel.tsx.
 */

import {
	ActivityIcon,
	BanIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	CircleDotIcon,
	CircleXIcon,
	EyeIcon,
	FlaskConicalIcon,
	LayersIcon,
	type LucideIcon,
	PackageCheckIcon,
} from "lucide-react";

import type { MilestoneStatus, MilestoneStatusFilter } from "./schema";

/** Text colour only, for places that already have their own surface. */
export const MILESTONE_STATUS_TEXT_CLASSES: Record<MilestoneStatus, string> = {
	todo: "text-milestone-todo",
	in_development: "text-milestone-in-development",
	in_testing: "text-milestone-in-testing",
	ready: "text-milestone-ready",
	in_review: "text-milestone-in-review",
	blocked: "text-milestone-blocked",
	done: "text-milestone-done",
	cancelled: "text-milestone-cancelled",
};

/** Text plus the matching tinted background, for the badge. */
export const MILESTONE_STATUS_BADGE_CLASSES: Record<MilestoneStatus, string> = {
	todo: "bg-milestone-todo-bg text-milestone-todo",
	in_development:
		"bg-milestone-in-development-bg text-milestone-in-development",
	in_testing: "bg-milestone-in-testing-bg text-milestone-in-testing",
	ready: "bg-milestone-ready-bg text-milestone-ready",
	in_review: "bg-milestone-in-review-bg text-milestone-in-review",
	blocked: "bg-milestone-blocked-bg text-milestone-blocked",
	done: "bg-milestone-done-bg text-milestone-done",
	cancelled: "bg-milestone-cancelled-bg text-milestone-cancelled line-through",
};

/**
 * One icon per state.
 *
 * A shared circle family reads as a single progress scale, which is how the
 * statuses relate to each other. Testing adds a flask and review an eye, so the
 * two checkpoints are recognisable without reading the label. `blocked` uses a
 * ban sign and `cancelled` an X so the terminal states stay distinct without
 * relying on colour.
 */
export const MILESTONE_STATUS_ICONS: Record<MilestoneStatus, LucideIcon> = {
	todo: CircleDashedIcon,
	in_development: CircleDotIcon,
	in_testing: FlaskConicalIcon,
	ready: PackageCheckIcon,
	in_review: EyeIcon,
	blocked: BanIcon,
	done: CircleCheckIcon,
	cancelled: CircleXIcon,
};

/**
 * Icons for the status filter, which mixes real statuses with two aggregates.
 *
 * `all` and `active` are not milestone states, so they use neutral icons
 * (layers and activity) instead of borrowing one state's symbol and implying
 * that every matching milestone is in that state.
 */
export const MILESTONE_STATUS_FILTER_ICONS: Record<
	MilestoneStatusFilter,
	LucideIcon
> = {
	all: LayersIcon,
	active: ActivityIcon,
	...MILESTONE_STATUS_ICONS,
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
