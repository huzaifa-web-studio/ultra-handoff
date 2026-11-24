/**
 * Milestone mutation hooks.
 *
 * Why this file: create, update, status, assignees, delete, lock and checklist
 * ticks all share the save indicator, the toast and the cache patch. Keeping
 * them together makes that contract visible.
 *
 * Used by: every milestone component that writes.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	createMilestone,
	deleteMilestone,
	lockMilestone,
	type MilestonePatch,
	setMilestoneAssignees,
	toggleMilestoneChecklist,
	unlockMilestone,
	updateMilestone,
} from "../api";
import { type MilestonePages, setMilestoneStatusInPages } from "../cache";
import type { MilestoneStatus } from "../schema";
import { milestoneDetailKey, milestonesKey } from "./keys";
import {
	syncMilestone,
	useInvalidateMilestoneList,
	useInvalidateMilestones,
} from "./sync";

export function useCreateMilestone(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateMilestones(orgSlug, projectId);

	return useMutation({
		mutationFn: (input: { title: string } & MilestonePatch) =>
			createMilestone(orgSlug, projectId, input),
		onSuccess: (data) => {
			syncMilestone(
				queryClient,
				orgSlug,
				projectId,
				data.milestone,
				data.viewer,
			);
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
			syncMilestone(
				queryClient,
				orgSlug,
				projectId,
				data.milestone,
				data.viewer,
			);

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
			syncMilestone(
				queryClient,
				orgSlug,
				projectId,
				data.milestone,
				data.viewer,
			);
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
			syncMilestone(
				queryClient,
				orgSlug,
				projectId,
				data.milestone,
				data.viewer,
			);
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

/**
 * Lock or unlock a milestone.
 *
 * The lock changes only the row and the detail, never the filter or the counts,
 * so the list rows are patched rather than refetched.
 */
export function useSetMilestoneLock(orgSlug: string, projectId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			milestoneId,
			locked,
			reason,
		}: {
			milestoneId: string;
			locked: boolean;
			reason?: string | null;
		}) =>
			locked
				? lockMilestone(orgSlug, projectId, milestoneId, reason)
				: unlockMilestone(orgSlug, projectId, milestoneId, reason),
		onSuccess: (data) => {
			syncMilestone(
				queryClient,
				orgSlug,
				projectId,
				data.milestone,
				data.viewer,
			);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not change the milestone lock.",
			);
		},
	});
}

/**
 * Tick one scope checklist item.
 *
 * Used only while the milestone is locked, where the scope is rendered read
 * only. The response is the whole detail, so the cache replaces the body
 * instead of guessing which node changed.
 */
export function useToggleMilestoneChecklist(
	orgSlug: string,
	projectId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			milestoneId,
			itemId,
			checked,
		}: {
			milestoneId: string;
			itemId: string;
			checked: boolean;
		}) =>
			toggleMilestoneChecklist(
				orgSlug,
				projectId,
				milestoneId,
				itemId,
				checked,
			),
		onSuccess: (data) => {
			syncMilestone(
				queryClient,
				orgSlug,
				projectId,
				data.milestone,
				data.viewer,
			);
		},
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not update the checklist.",
			);
		},
	});
}

/** One scope section body, fetched only when a reader opens it. */
