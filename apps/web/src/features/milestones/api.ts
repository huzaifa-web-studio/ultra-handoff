/**
 * Typed Eden calls for the milestones feature.
 *
 * Why a feature API module: components never call `api` directly. The request
 * shape, the error conversion and the derived types live here, so a change to
 * a route only touches this file.
 *
 * Used by: features/milestones/hooks.ts.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";
import type { MilestoneFilters, MilestoneStatus } from "./schema";

/** Any subset of fields. This is what autosave sends. */
export type MilestonePatch = {
	title?: string;
	description?: unknown;
	status?: MilestoneStatus;
	startDate?: string | null;
	dueDate?: string | null;
	estimateMinutes?: number | null;
	assigneeUserIds?: string[];
};

/** Read one page of milestones for a project. */
export async function fetchMilestones(
	orgSlug: string,
	projectId: string,
	filters: MilestoneFilters,
	page: number,
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones.get({
			query: {
				status: filters.status,
				sort: filters.sort,
				direction: filters.direction,
				page: String(page),
				pageSize: String(filters.pageSize),
				...(filters.search ? { search: filters.search } : {}),
			},
		});

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the milestones."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the milestones.", 0);
	}

	return response.data;
}

export type MilestonesResponse = Awaited<ReturnType<typeof fetchMilestones>>;
export type MilestoneSummary = MilestonesResponse["milestones"][number];
export type MilestoneCounts = MilestonesResponse["counts"];
export type MilestoneViewer = MilestonesResponse["viewer"];
export type MilestoneAssignee = MilestoneSummary["assignees"][number];

/** One milestone with the full editor document. */
export async function fetchMilestone(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the milestone."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the milestone.", 0);
	}

	return response.data;
}

export type MilestoneDetailResponse = Awaited<
	ReturnType<typeof fetchMilestone>
>;
export type MilestoneDetail = MilestoneDetailResponse["milestone"];

/** Create a milestone. The list invalidates, this call returns the detail. */
export async function createMilestone(
	orgSlug: string,
	projectId: string,
	input: { title: string } & MilestonePatch,
): Promise<MilestoneDetailResponse> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones.post(input);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not create the milestone."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not create the milestone.", 0);
	}

	return response.data;
}

/** Save any subset of fields. Field level, so autosave cannot clobber a body. */
export async function updateMilestone(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	patch: MilestonePatch,
): Promise<MilestoneDetailResponse> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.patch(patch);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not save the milestone."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not save the milestone.", 0);
	}

	return response.data;
}

/**
 * Replace the assignee set.
 *
 * A PUT with the full selection, so the call is idempotent and a stale picker
 * cannot leave a half applied set behind.
 */
export async function setMilestoneAssignees(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	userIds: string[],
): Promise<MilestoneDetailResponse> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.assignees.put({ userIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not update the assignees."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not update the assignees.", 0);
	}

	return response.data;
}

/** Permanently delete a milestone. */
export async function deleteMilestone(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
): Promise<{ status: "ok" }> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.delete();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not delete the milestone."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not delete the milestone.", 0);
	}

	return response.data;
}
