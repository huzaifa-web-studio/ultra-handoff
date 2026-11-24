/**
 * Milestone cache synchronisation.
 *
 * Why this file: a save, a realtime event and a mutation all have to write the
 * same detail and list cache entries. Keeping the patching rules together means
 * a remote event and a local save cannot drift.
 *
 * Used by: the mutation hooks and the realtime provider.
 */

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type {
	MilestoneDetail,
	MilestoneDetailResponse,
	MilestoneSummary,
	MilestoneViewer,
} from "../api";
import {
	type MilestonePages,
	patchMilestoneRow,
	removeMilestoneRow,
} from "../cache";
import { normalizeDay } from "../schema";
import { milestoneDetailKey, milestonesKey } from "./keys";

export function syncMilestone(
	queryClient: QueryClient,
	orgSlug: string,
	projectId: string,
	detail: MilestoneDetail,
	viewer?: MilestoneViewer,
): void {
	// The cache invariant is "dates are day-only". Normalising at this boundary
	// means a response that ever carries a timestamp cannot poison the list row
	// or the detail form.
	const normalized: MilestoneDetail = {
		...detail,
		startDate: normalizeDay(detail.startDate),
		dueDate: normalizeDay(detail.dueDate),
	};
	const milestoneId = normalized.id;

	queryClient.setQueryData<MilestoneDetailResponse>(
		milestoneDetailKey(orgSlug, projectId, milestoneId),
		(current) => ({
			projectId,
			viewer: viewer ??
				current?.viewer ?? {
					userId: "",
					canWrite: true,
					canTickChecklist: true,
					canComment: true,
					canLock: true,
					canWriteTestScope: false,
					canWriteReviewScope: false,
					archived: false,
				},
			milestone: normalized,
		}),
	);

	const summary: MilestoneSummary = { ...normalized };

	queryClient.setQueriesData<MilestonePages>(
		{ queryKey: [...milestonesKey(orgSlug, projectId), "list"] },
		(data) => (data ? patchMilestoneRow(data, summary) : data),
	);
}

/** One realtime milestone change, as the client applies it. */
export type MilestoneRealtimeEvent =
	| { kind: "created"; milestone: MilestoneSummary }
	| { kind: "updated"; milestone: MilestoneSummary; changed: readonly string[] }
	| { kind: "deleted"; milestoneId: string };

/**
 * Apply one realtime milestone change.
 *
 * Why the list is refetched only on a status change: status decides filter
 * membership and the counts. A title, date, estimate or assignee edit is a row
 * patch, and refetching the page for every one of those would make the list
 * flicker while somebody types.
 */
export function applyMilestoneEvent(
	queryClient: QueryClient,
	orgSlug: string,
	projectId: string,
	event: MilestoneRealtimeEvent,
): void {
	const listQuery = {
		queryKey: [...milestonesKey(orgSlug, projectId), "list"],
	};

	if (event.kind === "created") {
		void queryClient.invalidateQueries(listQuery);
		return;
	}

	if (event.kind === "deleted") {
		queryClient.setQueriesData<MilestonePages>(listQuery, (data) =>
			data ? removeMilestoneRow(data, event.milestoneId) : data,
		);

		queryClient.removeQueries({
			queryKey: milestoneDetailKey(orgSlug, projectId, event.milestoneId),
		});

		void queryClient.invalidateQueries(listQuery);
		return;
	}

	const summary: MilestoneSummary = {
		...event.milestone,
		startDate: normalizeDay(event.milestone.startDate),
		dueDate: normalizeDay(event.milestone.dueDate),
	};

	queryClient.setQueriesData<MilestonePages>(listQuery, (data) =>
		data ? patchMilestoneRow(data, summary) : data,
	);

	// The broadcast carries the summary, not the body, so merging keeps the
	// description the detail cache already holds.
	queryClient.setQueryData<MilestoneDetailResponse>(
		milestoneDetailKey(orgSlug, projectId, summary.id),
		(current) =>
			current
				? { ...current, milestone: { ...current.milestone, ...summary } }
				: current,
	);

	if (event.changed.includes("status")) {
		void queryClient.invalidateQueries(listQuery);
	}
}

/** Invalidate every milestone query in one project. */
export function useInvalidateMilestones(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();

	return () =>
		queryClient.invalidateQueries({
			queryKey: milestonesKey(orgSlug, projectId),
		});
}

/** Invalidate only the list pages, used after a status change. */
export function useInvalidateMilestoneList(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();

	return () =>
		queryClient.invalidateQueries({
			queryKey: [...milestonesKey(orgSlug, projectId), "list"],
		});
}

/** Create a milestone. The new row and the counts both change. */
