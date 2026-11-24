/**
 * Milestone read hooks.
 *
 * Why this file: the list and the detail are the only reads, and they share the
 * retry rule and the cache prefix. Keeping them together means the list and the
 * pane cannot page or retry differently.
 *
 * Used by: the milestone list and detail components.
 */

import {
	keepPreviousData,
	useInfiniteQuery,
	useQuery,
} from "@tanstack/react-query";
import { fetchMilestone, fetchMilestones } from "../api";
import type { MilestoneFilters } from "../schema";
import { listKey, milestoneDetailKey, retryMilestoneQuery } from "./keys";

export function useMilestones(
	orgSlug: string,
	projectId: string,
	filters: MilestoneFilters,
) {
	return useInfiniteQuery({
		queryKey: listKey(orgSlug, projectId, filters),
		queryFn: ({ pageParam }) =>
			fetchMilestones(orgSlug, projectId, filters, pageParam),
		initialPageParam: 1,
		getNextPageParam: (lastPage) =>
			lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
		enabled: Boolean(orgSlug) && Boolean(projectId),
		// Keeps the current rows on screen while a filter or page change loads.
		placeholderData: keepPreviousData,
		staleTime: 15_000,
		retry: retryMilestoneQuery,
	});
}

/** One milestone with the full editor document. */
export function useMilestoneDetail(
	orgSlug: string,
	projectId: string,
	milestoneId: string | null,
) {
	return useQuery({
		queryKey: milestoneDetailKey(orgSlug, projectId, milestoneId ?? ""),
		queryFn: () => fetchMilestone(orgSlug, projectId, milestoneId ?? ""),
		enabled: Boolean(orgSlug) && Boolean(projectId) && Boolean(milestoneId),
		staleTime: 10_000,
		retry: retryMilestoneQuery,
	});
}

/**
 * Write a detail response into the detail cache and the list rows.
 *
 * The list row is replaced with the detail minus the body. The type only
 * exposes the summary fields, so the extra `description` key the spread keeps
 * is invisible to every consumer.
 */
