/**
 * Data and mutations for milestone change requests.
 *
 * Why react-query: the Changes tab list, the create dialog and the decision
 * actions all read the same record, and one decision must refresh the list and
 * the open count on the milestone Overview. Every key shares the
 * `["organization", orgSlug, "milestones", projectId]` prefix, so a milestone
 * invalidation still reaches this module.
 *
 * The list is invalidated after every write instead of being patched by hand.
 * A decision moves a request between status buckets and changes several counts
 * at once, so a refetch is the simplest answer that cannot drift.
 *
 * Used by: features/milestones/changes/*.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiRequestError } from "#/lib/api";
import type { MilestoneDetailResponse } from "../api";
import { milestoneDetailKey, milestonesKey } from "../hooks";
import {
	type ChangeRequest,
	type ChangeRequestMoveResponse,
	type ChangeRequestWriteResponse,
	createChangeRequest,
	fetchChangeRequests,
	moveChangeRequestToMilestone,
	updateChangeRequest,
} from "./api";

/** One milestone's change request list. */
export function changesKey(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	return [
		"organization",
		orgSlug,
		"milestones",
		projectId,
		"changes",
		milestoneId,
	] as const;
}

/** Retry policy: a permission or missing answer is not transient. */
function retryChanges(failureCount: number, error: unknown): boolean {
	if (
		error instanceof ApiRequestError &&
		(error.status === 403 || error.status === 404)
	) {
		return false;
	}

	return failureCount < 2;
}

/** The list, loaded once per open of the Changes tab. */
export function useChangeRequests(
	orgSlug: string,
	projectId: string,
	milestoneId: string | null,
	options?: { enabled?: boolean },
) {
	return useQuery({
		queryKey: changesKey(orgSlug, projectId, milestoneId ?? ""),
		queryFn: () => fetchChangeRequests(orgSlug, projectId, milestoneId ?? ""),
		enabled:
			Boolean(orgSlug) &&
			Boolean(projectId) &&
			Boolean(milestoneId) &&
			(options?.enabled ?? true),
		staleTime: 10_000,
		retry: retryChanges,
	});
}

/**
 * Write the open count into the milestone detail cache.
 *
 * The Overview and the Changes tab badge both read this value, and a mutation
 * response already carries the new number, so a full detail refetch would be
 * wasted work.
 */
export function patchOpenChangeCount(
	queryClient: ReturnType<typeof useQueryClient>,
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	openCount: number,
): void {
	queryClient.setQueryData<MilestoneDetailResponse>(
		milestoneDetailKey(orgSlug, projectId, milestoneId),
		(current) =>
			current
				? {
						...current,
						milestone: {
							...current.milestone,
							openChangeRequestCount: openCount,
						},
					}
				: current,
	);
}

/** Shared success handling for every change request write. */
function useApplyWrite(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	options?: { newMilestone?: boolean },
) {
	const queryClient = useQueryClient();

	return (data: ChangeRequestWriteResponse | ChangeRequestMoveResponse) => {
		patchOpenChangeCount(
			queryClient,
			orgSlug,
			projectId,
			milestoneId,
			data.openCount,
		);
		void queryClient.invalidateQueries({
			queryKey: changesKey(orgSlug, projectId, milestoneId),
		});

		// Moving a request creates a milestone, so the list and the counts have
		// to be read again.
		if (options?.newMilestone) {
			void queryClient.invalidateQueries({
				queryKey: milestonesKey(orgSlug, projectId),
			});
		}
	};
}

/** Raise a request. */
export function useCreateChangeRequest(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const onSuccess = useApplyWrite(orgSlug, projectId, milestoneId);

	return useMutation({
		mutationFn: (input: { title: string; body?: unknown[] }) =>
			createChangeRequest(orgSlug, projectId, milestoneId, input),
		onSuccess: (data) => onSuccess(data),
	});
}

/** Edit the text of an open request. */
export function useUpdateChangeRequest(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const onSuccess = useApplyWrite(orgSlug, projectId, milestoneId);

	return useMutation({
		mutationFn: ({
			changeId,
			title,
			body,
		}: {
			changeId: string;
			title?: string;
			body?: unknown[];
		}) =>
			updateChangeRequest(orgSlug, projectId, milestoneId, changeId, {
				...(title !== undefined ? { title } : {}),
				...(body !== undefined ? { body } : {}),
			}),
		onSuccess: (data) => onSuccess(data),
	});
}

/**
 * Record a decision.
 *
 * `accepted` and `declined` require staff. `withdrawn` is the author's action.
 * The same mutation covers all three because the route validates who may do
 * what, and the UI only offers an action the viewer can complete.
 */
export function useDecideChangeRequest(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const queryClient = useQueryClient();
	const onSuccess = useApplyWrite(orgSlug, projectId, milestoneId);

	return useMutation({
		mutationFn: ({
			changeId,
			status,
			note,
			scopeTitle,
			scopeBody,
		}: {
			changeId: string;
			status: ChangeRequest["status"];
			note?: string | null;
			scopeTitle?: string;
			scopeBody?: unknown;
		}) =>
			updateChangeRequest(orgSlug, projectId, milestoneId, changeId, {
				status,
				...(note !== undefined ? { note } : {}),
				...(scopeTitle !== undefined ? { scopeTitle } : {}),
				...(scopeBody !== undefined ? { scopeBody } : {}),
			}),
		onSuccess: (data) => {
			onSuccess(data);
			// An acceptance adds a section to the scope, so the detail metadata
			// has to be read again for the Scope tab and Overview summary.
			void queryClient.invalidateQueries({
				queryKey: milestoneDetailKey(orgSlug, projectId, milestoneId),
			});
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Could not save the decision.",
			);
		},
	});
}

/** Turn a request into a new milestone. */
export function useMoveChangeRequest(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const onSuccess = useApplyWrite(orgSlug, projectId, milestoneId, {
		newMilestone: true,
	});

	return useMutation({
		mutationFn: ({
			changeId,
			input,
		}: {
			changeId: string;
			input: Parameters<typeof moveChangeRequestToMilestone>[4];
		}) =>
			moveChangeRequestToMilestone(
				orgSlug,
				projectId,
				milestoneId,
				changeId,
				input,
			),
		onSuccess: (data) => onSuccess(data),
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not move the change request.",
			);
		},
	});
}
