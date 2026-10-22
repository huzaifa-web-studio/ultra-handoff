/**
 * Typed Eden calls for the projects feature.
 *
 * Why a feature API module: components never call `api` directly, so the
 * request shape and the error conversion live in one place. Return types are
 * derived from the calls, which keeps the table and dialogs in sync with the
 * API without a shared types package.
 *
 * Used by: features/projects/hooks.ts.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";

/** Everything the projects list request accepts. */
export type ProjectListFilters = {
	search: string;
	status: "all" | "active" | "archived";
	sort: "name" | "createdAt" | "updatedAt";
	direction: "asc" | "desc";
	page: number;
	pageSize: number;
};

/** The roles a project member can hold, as written by the API. */
export type ProjectRoleInput = "owner" | "admin" | "member" | "client";

/** Read one page of projects the caller is allowed to see. */
export async function fetchProjects(
	orgSlug: string,
	filters: ProjectListFilters,
) {
	const response = await api.orgs({ orgSlug }).projects.get({
		query: {
			status: filters.status,
			sort: filters.sort,
			direction: filters.direction,
			page: String(filters.page),
			pageSize: String(filters.pageSize),
			...(filters.search ? { search: filters.search } : {}),
		},
	});

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the projects."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the projects.", 0);
	}

	return response.data;
}

export type ProjectsResponse = Awaited<ReturnType<typeof fetchProjects>>;
export type ProjectRow = ProjectsResponse["projects"][number];

/** Project, members and viewer capabilities. */
export async function fetchProject(orgSlug: string, projectId: string) {
	const response = await api.orgs({ orgSlug }).projects({ projectId }).get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the project."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the project.", 0);
	}

	return response.data;
}

export type ProjectDetailResponse = Awaited<ReturnType<typeof fetchProject>>;
export type ProjectMemberRow = ProjectDetailResponse["members"][number];
export type ProjectViewer = ProjectDetailResponse["viewer"];

/** Create a project. Organization owners and admins only. */
export async function createProject(
	orgSlug: string,
	input: { name: string; slug: string; description?: string; logo?: string },
): Promise<ProjectDetailResponse> {
	const response = await api.orgs({ orgSlug }).projects.post({
		name: input.name,
		slug: input.slug,
		...(input.description ? { description: input.description } : {}),
		...(input.logo ? { logo: input.logo } : {}),
	});

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not create the project."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not create the project.", 0);
	}

	return response.data;
}

/** Update the editable fields. A null logo clears it. */
export async function updateProject(
	orgSlug: string,
	projectId: string,
	input: {
		name?: string;
		slug?: string;
		description?: string | null;
		logo?: string | null;
	},
): Promise<ProjectDetailResponse> {
	const body: {
		name?: string;
		slug?: string;
		description?: string;
		logo?: string;
	} = {};

	if (input.name !== undefined) body.name = input.name;
	if (input.slug !== undefined) body.slug = input.slug;
	if (input.description !== undefined) {
		body.description = input.description ?? "";
	}
	if (input.logo !== undefined) body.logo = input.logo ?? "";

	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.patch(body);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not update the project."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not update the project.", 0);
	}

	return response.data;
}

/** Archive a project. Idempotent. */
export async function archiveProject(
	orgSlug: string,
	projectId: string,
): Promise<{ status: "active" | "archived"; archivedAt: string | null }> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.archive.post();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not archive the project."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not archive the project.", 0);
	}

	return response.data;
}

/** Restore an archived project. Idempotent. */
export async function unarchiveProject(
	orgSlug: string,
	projectId: string,
): Promise<{ status: "active" | "archived"; archivedAt: string | null }> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.unarchive.post();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not restore the project."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not restore the project.", 0);
	}

	return response.data;
}

/** Permanent delete. Project owners only. */
export async function deleteProject(
	orgSlug: string,
	projectId: string,
): Promise<{ status: "ok" }> {
	const response = await api.orgs({ orgSlug }).projects({ projectId }).delete();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not delete the project."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not delete the project.", 0);
	}

	return response.data;
}

/** One outcome in a project bulk response. */
export type ProjectBulkItemResult = Awaited<
	ReturnType<typeof bulkDeleteProjects>
>["results"][number];

/** Archive several projects, with per item outcomes. */
export async function bulkArchiveProjects(
	orgSlug: string,
	projectIds: string[],
): Promise<{ results: ProjectBulkItemResult[] }> {
	const response = await api
		.orgs({ orgSlug })
		.projects["bulk-archive"].post({ projectIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not archive those projects."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not archive those projects.", 0);
	}

	return response.data;
}

/** Restore several archived projects, with per item outcomes. */
export async function bulkUnarchiveProjects(
	orgSlug: string,
	projectIds: string[],
): Promise<{ results: ProjectBulkItemResult[] }> {
	const response = await api
		.orgs({ orgSlug })
		.projects["bulk-unarchive"].post({ projectIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not restore those projects."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not restore those projects.", 0);
	}

	return response.data;
}

/** Permanently delete several projects, with per item outcomes. */
export async function bulkDeleteProjects(
	orgSlug: string,
	projectIds: string[],
) {
	const response = await api
		.orgs({ orgSlug })
		.projects["bulk-delete"].post({ projectIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not delete those projects."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not delete those projects.", 0);
	}

	return response.data;
}

/**
 * Add several workspace members to one project.
 *
 * A batch can contain a person who already joined, so the API answers per
 * person instead of failing the whole request.
 */
export async function bulkAddProjectMembers(
	orgSlug: string,
	projectId: string,
	userIds: string[],
	role: ProjectRoleInput,
): Promise<{ results: ProjectBulkItemResult[] }> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.members.bulk.post({ userIds, role });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not add those people."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not add those people.", 0);
	}

	return response.data;
}

/**
 * Remove several project members in one request.
 *
 * A batch can contain a person another owner just removed, so the API answers
 * per person instead of failing the whole request.
 */
export async function bulkRemoveProjectMembers(
	orgSlug: string,
	projectId: string,
	userIds: string[],
): Promise<{ results: ProjectBulkItemResult[] }> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.members["bulk-remove"].post({ userIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not remove those people."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not remove those people.", 0);
	}

	return response.data;
}

/** Change one project member's role. */
export async function updateProjectMemberRole(
	orgSlug: string,
	projectId: string,
	userId: string,
	role: ProjectRoleInput,
): Promise<{ userId: string; role: string }> {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.members({ userId })
		.patch({ role });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not change that role."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not change that role.", 0);
	}

	return response.data;
}
