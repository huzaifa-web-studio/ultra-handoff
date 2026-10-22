/**
 * Data and mutations for the projects feature.
 *
 * Why react-query: the table, the edit dialog and the members dialog all read
 * project data, and a mutation must refresh each of them. Every key shares the
 * `["organization", orgSlug, "projects"]` prefix, so one invalidation covers
 * the list, the filters and the open detail.
 *
 * Used by: routes/_app/$orgSlug.projects.tsx and the project dialogs.
 */

import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { ApiRequestError } from "#/lib/api";
import {
	addProjectMember,
	archiveProject,
	createProject,
	deleteProject,
	fetchProject,
	fetchProjects,
	type ProjectListFilters,
	removeProjectMember,
	unarchiveProject,
	updateProject,
	updateProjectMemberRole,
} from "./api";

/** Prefix shared by every project query in one workspace. */
export function projectsKey(orgSlug: string) {
	return ["organization", orgSlug, "projects"] as const;
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
		// A 403 or 404 is a permission or existence answer, not a transient
		// failure. Retrying only delays the access card.
		retry: (failureCount, error) => {
			if (
				error instanceof ApiRequestError &&
				(error.status === 403 || error.status === 404)
			) {
				return false;
			}

			return failureCount < 2;
		},
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
		retry: (failureCount, error) => {
			if (
				error instanceof ApiRequestError &&
				(error.status === 403 || error.status === 404)
			) {
				return false;
			}

			return failureCount < 2;
		},
	});
}

/** Invalidate every project query in one workspace. */
function useInvalidateProjects(orgSlug: string) {
	const queryClient = useQueryClient();

	return () =>
		queryClient.invalidateQueries({ queryKey: projectsKey(orgSlug) });
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

export function useDeleteProject(orgSlug: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (projectId: string) => deleteProject(orgSlug, projectId),
		onSuccess: invalidate,
	});
}

export function useAddProjectMember(orgSlug: string, projectId: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: ({
			userId,
			role,
		}: {
			userId: string;
			role: "owner" | "admin" | "member" | "client";
		}) => addProjectMember(orgSlug, projectId, userId, role),
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
			role: "owner" | "admin" | "member" | "client";
		}) => updateProjectMemberRole(orgSlug, projectId, userId, role),
		onSuccess: invalidate,
	});
}

export function useRemoveProjectMember(orgSlug: string, projectId: string) {
	const invalidate = useInvalidateProjects(orgSlug);

	return useMutation({
		mutationFn: (userId: string) =>
			removeProjectMember(orgSlug, projectId, userId),
		onSuccess: invalidate,
	});
}
