/**
 * Data and mutations for the milestones feature.
 *
 * Why react-query: the list, the detail pane and the filter chips all read
 * milestone data, and one save must refresh each of them. Every key shares the
 * `["organization", orgSlug, "milestones", projectId]` prefix, so one
 * invalidation covers the whole feature.
 *
 * Cache strategy for autosave:
 *   - a field save writes the returned detail straight into the detail cache
 *   - the matching row in every list cache is patched in place, so typing does
 *     not refetch a page of milestones
 *   - a status change and a create or delete invalidate the list, because those
 *     are the only operations that change the filter chips and paging
 *
 * Used by: every component in features/milestones.
 */

import {
	keepPreviousData,
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiRequestError } from "#/lib/api";
import {
	createMilestone,
	deleteMilestone,
	fetchMilestone,
	fetchMilestones,
	type MilestoneDetail,
	type MilestoneDetailResponse,
	type MilestonePatch,
	type MilestoneSummary,
	setMilestoneAssignees,
	updateMilestone,
} from "./api";
import {
	type MilestonePages,
	patchMilestoneRow,
	removeMilestoneRow,
	setMilestoneStatusInPages,
} from "./cache";
import {
	type MilestoneFilters,
	type MilestoneStatus,
	normalizeDay,
} from "./schema";

/** Prefix shared by every milestone query in one project. */
export function milestonesKey(orgSlug: string, projectId: string) {
	return ["organization", orgSlug, "milestones", projectId] as const;
}

/** One filtered page set. */
function listKey(
	orgSlug: string,
	projectId: string,
	filters: MilestoneFilters,
) {
	return [...milestonesKey(orgSlug, projectId), "list", filters] as const;
}

/** One milestone detail. Exported so the comments feature can patch its count. */
function detailKey(orgSlug: string, projectId: string, milestoneId: string) {
	return [...milestonesKey(orgSlug, projectId), "detail", milestoneId] as const;
}

/**
 * A 403 or 404 is a permission or existence answer, not a transient failure.
 * Retrying only delays the access card, so those stop after the first answer.
 */
function retryMilestoneQuery(failureCount: number, error: unknown): boolean {
	if (
		error instanceof ApiRequestError &&
		(error.status === 403 || error.status === 404)
	) {
		return false;
	}

	return failureCount < 2;
}

/** The infinite list, one page at a time. */
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
		queryKey: detailKey(orgSlug, projectId, milestoneId ?? ""),
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
function syncMilestone(
	queryClient: QueryClient,
	orgSlug: string,
	projectId: string,
	detail: MilestoneDetail,
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
		detailKey(orgSlug, projectId, milestoneId),
		(current) => ({
			projectId,
			viewer: current?.viewer ?? {
				userId: "",
				canWrite: true,
				canComment: true,
				locked: false,
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
			queryKey: detailKey(orgSlug, projectId, event.milestoneId),
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
		detailKey(orgSlug, projectId, summary.id),
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
function useInvalidateMilestones(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();

	return () =>
		queryClient.invalidateQueries({
			queryKey: milestonesKey(orgSlug, projectId),
		});
}

/** Invalidate only the list pages, used after a status change. */
function useInvalidateMilestoneList(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();

	return () =>
		queryClient.invalidateQueries({
			queryKey: [...milestonesKey(orgSlug, projectId), "list"],
		});
}

/** Create a milestone. The new row and the counts both change. */
export function useCreateMilestone(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateMilestones(orgSlug, projectId);

	return useMutation({
		mutationFn: (input: { title: string } & MilestonePatch) =>
			createMilestone(orgSlug, projectId, input),
		onSuccess: (data) => {
			syncMilestone(queryClient, orgSlug, projectId, data.milestone);
			void invalidate();
		},
	});
}

/**
 * Save any subset of fields.
 *
 * A status change invalidates the list because the filter chips and the row's
 * membership of the current filter both depend on it. Every other field is
 * patched in place, which is what makes autosave quiet.
 */
export function useUpdateMilestone(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();
	const invalidateList = useInvalidateMilestoneList(orgSlug, projectId);

	return useMutation({
		mutationFn: ({
			milestoneId,
			patch,
		}: {
			milestoneId: string;
			patch: MilestonePatch;
		}) => updateMilestone(orgSlug, projectId, milestoneId, patch),
		onSuccess: (data, variables) => {
			syncMilestone(queryClient, orgSlug, projectId, data.milestone);

			if (variables.patch.status !== undefined) {
				void invalidateList();
			}
		},
	});
}

/**
 * Change one milestone's status from the list.
 *
 * Why optimistic: the badge is the control, so waiting for the round trip would
 * make the click look ignored. The row is patched at once and restored if the
 * request fails. The list is invalidated afterwards because a status change
 * moves the row between filters and changes the counts.
 */
export function useSetMilestoneStatus(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();
	const listQuery = {
		queryKey: [...milestonesKey(orgSlug, projectId), "list"],
	};

	return useMutation({
		mutationFn: ({
			milestoneId,
			status,
		}: {
			milestoneId: string;
			status: MilestoneStatus;
		}) => updateMilestone(orgSlug, projectId, milestoneId, { status }),
		onMutate: async ({ milestoneId, status }) => {
			await queryClient.cancelQueries(listQuery);

			const previous = queryClient.getQueriesData<MilestonePages>(listQuery);

			queryClient.setQueriesData<MilestonePages>(listQuery, (data) =>
				data ? setMilestoneStatusInPages(data, milestoneId, status) : data,
			);

			return { previous };
		},
		onError: (error, _variables, context) => {
			for (const [key, data] of context?.previous ?? []) {
				queryClient.setQueryData(key, data);
			}

			toast.error(
				error instanceof Error ? error.message : "Could not change the status.",
			);
		},
		onSuccess: (data) => {
			syncMilestone(queryClient, orgSlug, projectId, data.milestone);
			void queryClient.invalidateQueries(listQuery);
		},
	});
}

/** Replace the assignee set. Assignees do not affect the counts. */
export function useSetMilestoneAssignees(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			milestoneId,
			userIds,
		}: {
			milestoneId: string;
			userIds: string[];
		}) => setMilestoneAssignees(orgSlug, projectId, milestoneId, userIds),
		onSuccess: (data) => {
			syncMilestone(queryClient, orgSlug, projectId, data.milestone);
		},
	});
}

/** Permanently delete a milestone. The row and the counts both change. */
export function useDeleteMilestone(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateMilestones(orgSlug, projectId);

	return useMutation({
		mutationFn: (milestoneId: string) =>
			deleteMilestone(orgSlug, projectId, milestoneId),
		onSuccess: (_data, milestoneId) => {
			queryClient.removeQueries({
				queryKey: detailKey(orgSlug, projectId, milestoneId),
			});
			void invalidate();
		},
	});
}
