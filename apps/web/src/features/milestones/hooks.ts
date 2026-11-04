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
	type InfiniteData,
	keepPreviousData,
	type QueryClient,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

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
	type MilestonesResponse,
	setMilestoneAssignees,
	updateMilestone,
} from "./api";
import { type MilestoneFilters, normalizeDay } from "./schema";

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
		milestoneDetailKey(orgSlug, projectId, milestoneId),
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

	queryClient.setQueriesData<InfiniteData<MilestonesResponse, number>>(
		{ queryKey: [...milestonesKey(orgSlug, projectId), "list"] },
		(data) => {
			if (!data) return data;

			return {
				...data,
				pages: data.pages.map((page) => ({
					...page,
					milestones: page.milestones.map((row) =>
						row.id === milestoneId ? summary : row,
					),
				})),
			};
		},
	);
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
				queryKey: milestoneDetailKey(orgSlug, projectId, milestoneId),
			});
			void invalidate();
		},
	});
}
