/**
 * Typed Eden calls for milestone change requests.
 *
 * Why a feature API module: components never call `api` directly. The request
 * shape, the error conversion and the derived types live here, so a change to a
 * route only touches this file.
 *
 * Used by: features/milestones/changes/hooks.ts.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";
import type { MilestoneDetail } from "../api";

/** Read every change request for one milestone, with its counts. */
export async function fetchChangeRequests(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.changes.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the change requests."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the change requests.", 0);
	}

	return response.data;
}

export type ChangeRequestsResponse = Awaited<
	ReturnType<typeof fetchChangeRequests>
>;
export type ChangeRequest = ChangeRequestsResponse["changeRequests"][number];
export type ChangeRequestCounts = ChangeRequestsResponse["counts"];
export type ChangeRequestStatus = ChangeRequest["status"];

/** Raise a request. The client may do this even when the milestone is locked. */
export async function createChangeRequest(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	input: { title: string; body?: unknown[] },
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.changes.post(input);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not create the change request."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not create the change request.", 0);
	}

	return response.data;
}

export type ChangeRequestWriteResponse = Awaited<
	ReturnType<typeof createChangeRequest>
>;

/**
 * Edit the text of an open request, or record a decision.
 *
 * Never both in one call: the server rejects it so the record stays honest
 * about what was accepted.
 */
export async function updateChangeRequest(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	changeId: string,
	input: {
		title?: string;
		body?: unknown[];
		status?: ChangeRequestStatus;
		note?: string | null;
	},
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.changes({ changeId })
		.patch(input);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not save the change request."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not save the change request.", 0);
	}

	return response.data;
}

/** Create a new milestone from a request and mark the request moved. */
export async function moveChangeRequestToMilestone(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	changeId: string,
	input: {
		title: string;
		description?: unknown[];
		status?: MilestoneDetail["status"];
		statusNote?: string | null;
		startDate?: string | null;
		dueDate?: string | null;
		estimateMinutes?: number | null;
		assigneeUserIds?: string[];
	},
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.changes({ changeId })
		["to-milestone"].post(input);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not move the change request."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not move the change request.", 0);
	}

	return response.data;
}

export type ChangeRequestMoveResponse = Awaited<
	ReturnType<typeof moveChangeRequestToMilestone>
>;
