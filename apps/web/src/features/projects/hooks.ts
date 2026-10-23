/**
 * Data and mutations for the projects feature.
 *
 * Why react-query: the table, the edit dialog and the members dialog all read
 * project data, and a mutation must refresh each of them. Every key shares the
 * `["organization", orgSlug, "projects"]` prefix, so one invalidation covers
 * the list, the filters and the open detail.
 *
 * Used by: routes/_app/$orgSlug.projects.index.tsx, the sidebar and the
 * project page, plus the project dialogs.
 */

import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { ApiRequestError } from "#/lib/api";
import { SIDEBAR_PROJECTS_PAGE_SIZE } from "#/lib/limits";
import {
	archiveProject,
	bulkAddProjectMembers,
	bulkArchiveProjects,
	bulkDeleteProjects,
	bulkRemoveProjectMembers,
	bulkUnarchiveProjects,
	createProject,
	deleteProject,
	fetchProject,
	fetchProjectBySlug,
	fetchProjects,
	fetchSidebarProjects,
	type ProjectListFilters,
	type ProjectRoleInput,
	setProjectArchiveVisibility,
	setProjectPinned,
	unarchiveProject,
	updateProject,
	updateProjectMemberRole,
} from "./api";

/** Prefix shared by every project query in one workspace. */
export function projectsKey(orgSlug: string) {
	return ["organization", orgSlug, "projects"] as const;
}

/**
 * A 403 or 404 is a permission or existence answer, not a transient failure.
 * Retrying only delays the access card, so both the list and the detail stop
 * after the first such answer.
 */
function retryProjectQuery(failureCount: number, error: unknown): boolean {
	if (
		error instanceof ApiRequestError &&
		(error.status === 403 || error.status === 404)
	) {
		return false;
	}

	return failureCount < 2;
}

/** One page of the projects table. */
export function useProjects(orgSlug: string, filters: ProjectListFilters) {
	return useQuery({
		queryKey: [...projectsKey(orgSlug), "list", filters],
		queryFn: () => fetchProjects(orgSlug, filters),
		// Paging and filtering keep the previous rows on screen instead of
		// flashing an empty table while the next page is in flight.
		placeholderData: keepPreviousData,
		staleTime: 15_000,
		retry: retryProjectQuery,
	});
}

/** Project, members and viewer capabilities for the open dialogs. */
export function useProjectDetail(
	orgSlug: string,
	projectId: string | null,
	enabled = true,
) {
	return useQuery({
		queryKey: [...projectsKey(orgSlug), "detail", projectId],
		queryFn: () => fetchProject(orgSlug, projectId ?? ""),
		enabled: enabled && Boolean(projectId),
		staleTime: 10_000,
		retry: retryProjectQuery,
	});
}

/**
 * The project page payload, looked up by the slug that appears in the URL.
 *
 * Kept separate from `useProjectDetail` because the dialogs address projects by
 * their immutable id, and the page addresses them by the readable slug. Both
 * share the same cache prefix, so a mutation invalidates both.
 */
export function useProjectDetailBySlug(orgSlug: string, projectSlug: string) {
	return useQuery({
		queryKey: [...projectsKey(orgSlug), "detail-by-slug", projectSlug],
		queryFn: () => fetchProjectBySlug(orgSlug, projectSlug),
		enabled: Boolean(orgSlug) && Boolean(projectSlug),
		staleTime: 10_000,
		retry: retryProjectQuery,
	});
}

/** Invalidate every project query in one workspace. */
function useInvalidateProjects(orgSlug: string) {
	const queryClient = useQueryClient();

	return () =>
		queryClient.invalidateQueries({ queryKey: projectsKey(orgSlug) });
}

/**
 * The caller's pinned projects for the sidebar.
 *
 * The sidebar is visible on every screen, so this avoids refetching on every
 * navigation. A pin or a project change invalidates the shared prefix.
 */
export function useSidebarProjects(orgSlug: string) {
	return useQuery({
		queryKey: [...projectsKey(orgSlug), "sidebar"],
		queryFn: () => fetchSidebarProjects(orgSlug),
		enabled: Boolean(orgSlug),
		staleTime: 60_000,
		retry: retryProjectQuery,
	});
}

/**
 * The paginated all-projects list for the sidebar.
 *
 * Why infinite: the sidebar can hold any number of projects, and loading them
 * all at once would make the payload and the first paint needlessly heavy. Each
 * page is small and the list asks for the next one as the user scrolls.
 *
 * Active projects only. Archived work stays on the projects page, where the
 * status filter and restore action live.
 */
export function useSidebarAllProjects(orgSlug: string) {
	return useInfiniteQuery({
		queryKey: [...projectsKey(orgSlug), "sidebar-all"],
		queryFn: ({ pageParam }) =>
			fetchProjects(orgSlug, {
				search: "",
				status: "active",
				// Alphabetical so the list is predictable while browsing.
				sort: "name",
				direction: "asc",
				page: pageParam,
				pageSize: SIDEBAR_PROJECTS_PAGE_SIZE,
			}),
		initialPageParam: 1,
		getNextPageParam: (lastPage) =>
			lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
		enabled: Boolean(orgSlug),
		staleTime: 60_000,
		retry: retryProjectQuery,
	});
}

/** Pin or unpin a project. Idempotent, so a double click is harmless. */
export function useSetProjectPinned(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: ({
			projectId,
			pinned,
		}: {
			projectId: string;
			pinned: boolean;
		}) => setProjectPinned(orgSlug, projectId, pinned),
		onSuccess: invalidate,
	});
}

export function useCreateProject(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (input: {
			name: string;
			slug: string;
			description?: string;
			logo?: string;
		}) => createProject(orgSlug, input),
		onSuccess: invalidate,
	});
}

export function useUpdateProject(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: ({
			projectId,
			...input
		}: {
			projectId: string;
			name?: string;
			slug?: string;
			description?: string | null;
			logo?: string | null;
		}) => updateProject(orgSlug, projectId, input),
		onSuccess: invalidate,
	});
}

export function useArchiveProject(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (projectId: string) => archiveProject(orgSlug, projectId),
		onSuccess: invalidate,
	});
}

export function useUnarchiveProject(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (projectId: string) => unarchiveProject(orgSlug, projectId),
		onSuccess: invalidate,
	});
}

/**
 * Toggle whether clients keep seeing this project while it is archived.
 *
 * Allowed while archived, so the setting stays reachable without a restore.
 */
export function useSetProjectArchiveVisibility(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: ({
			projectId,
			visibleToClient,
		}: {
			projectId: string;
			visibleToClient: boolean;
		}) => setProjectArchiveVisibility(orgSlug, projectId, visibleToClient),
		onSuccess: invalidate,
	});
}

export function useDeleteProject(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (projectId: string) => deleteProject(orgSlug, projectId),
		onSuccess: invalidate,
	});
}

export function useBulkArchiveProjects(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (projectIds: string[]) =>
			bulkArchiveProjects(orgSlug, projectIds),
		onSuccess: invalidate,
	});
}

export function useBulkUnarchiveProjects(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (projectIds: string[]) =>
			bulkUnarchiveProjects(orgSlug, projectIds),
		onSuccess: invalidate,
	});
}

export function useBulkDeleteProjects(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (projectIds: string[]) =>
			bulkDeleteProjects(orgSlug, projectIds),
		onSuccess: invalidate,
	});
}

export function useBulkAddProjectMembers(orgSlug: string, projectId: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: ({
			userIds,
			role,
		}: {
			userIds: string[];
			role: ProjectRoleInput;
		}) => bulkAddProjectMembers(orgSlug, projectId, userIds, role),
		onSuccess: invalidate,
	});
}

export function useUpdateProjectMemberRole(orgSlug: string, projectId: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: ({
			userId,
			role,
		}: {
			userId: string;
			role: ProjectRoleInput;
		}) => updateProjectMemberRole(orgSlug, projectId, userId, role),
		onSuccess: invalidate,
	});
}

export function useBulkRemoveProjectMembers(
	orgSlug: string,
	projectId: string,
) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (userIds: string[]) =>
			bulkRemoveProjectMembers(orgSlug, projectId, userIds),
		onSuccess: invalidate,
	});
}
