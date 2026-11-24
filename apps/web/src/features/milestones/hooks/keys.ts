/**
 * Milestone query keys.
 *
 * Why this file: every cache key shares one prefix, and one invalidation has to
 * reach the list, the detail and every scope entry. Keeping the keys together
 * makes that prefix explicit.
 *
 * Used by: the read and mutation hooks in `features/milestones/hooks/`.
 */

import { ApiRequestError } from "#/lib/api";
import type { MilestoneFilters } from "../schema";

export function milestonesKey(orgSlug: string, projectId: string) {
	return ["organization", orgSlug, "milestones", projectId] as const;
}

/** One filtered page set. */
export function listKey(
	orgSlug: string,
	projectId: string,
	filters: MilestoneFilters,
) {
	return [...milestonesKey(orgSlug, projectId), "list", filters] as const;
}

/** One milestone detail. Exported so other feature modules can patch it. */
export function milestoneDetailKey(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	return [...milestonesKey(orgSlug, projectId), "detail", milestoneId] as const;
}

/**
 * A 403 or 404 is a permission or existence answer, not a transient failure.
 * Retrying only delays the access card, so those stop after the first answer.
 */
export function retryMilestoneQuery(
	failureCount: number,
	error: unknown,
): boolean {
	if (
		error instanceof ApiRequestError &&
		(error.status === 403 || error.status === 404)
	) {
		return false;
	}

	return failureCount < 2;
}

/** The infinite list, one page at a time. */
