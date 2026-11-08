/**
 * Pure milestone list reducers.
 *
 * Why pure: the same patch runs for a mutation response and a realtime event.
 * Keeping it free of React and the query client means the row replacement and
 * removal are cheap to test, and the two paths cannot drift apart.
 *
 * Used by: features/milestones/hooks.ts.
 */

import type { InfiniteData } from "@tanstack/react-query";

import type { MilestoneSummary, MilestonesResponse } from "./api";
import type { MilestoneStatus } from "./schema";

/** The shape react-query stores for the milestone list. */
export type MilestonePages = InfiniteData<MilestonesResponse, number>;

/**
 * Replace one row in every loaded page.
 *
 * A broadcast summary is the whole row, so replacing is simpler and safer than
 * merging: a cleared due date must become null, not keep the old value.
 */
export function patchMilestoneRow(
	data: MilestonePages,
	summary: MilestoneSummary,
): MilestonePages {
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			milestones: page.milestones.map((row) =>
				row.id === summary.id ? summary : row,
			),
		})),
	};
}

/** Remove one row from every loaded page. */
export function removeMilestoneRow(
	data: MilestonePages,
	milestoneId: string,
): MilestonePages {
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			milestones: page.milestones.filter((row) => row.id !== milestoneId),
		})),
	};
}

/**
 * Set one row's status in every loaded page.
 *
 * Why its own reducer: the list row's badge is now the status control, so the
 * new value has to appear before the request returns. Only `status` is replaced,
 * which keeps every other field exactly as the cache already had it.
 */
export function setMilestoneStatusInPages(
	data: MilestonePages,
	milestoneId: string,
	status: MilestoneStatus,
): MilestonePages {
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			milestones: page.milestones.map((row) =>
				row.id === milestoneId ? { ...row, status } : row,
			),
		})),
	};
}
