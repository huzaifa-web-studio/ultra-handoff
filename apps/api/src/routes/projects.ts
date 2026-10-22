/**
 * Project routes.
 *
 * Why a route file: the tenant macro resolves `:orgSlug` to a verified
 * organization and the service owns the project rules. The routes only parse
 * and clamp input and translate service failures into typed HTTP responses.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import { BULK_SELECTION_MAX } from "../auth/permissions";
import type { ProjectRole } from "../auth/project-permissions";
import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import {
	addProjectMember,
	bulkAddProjectMembers,
	bulkDeleteProjects,
	bulkRemoveProjectMembers,
	bulkSetProjectsArchived,
	createProject,
	deleteProject,
	getProjectDetail,
	listProjects,
	type ProjectListQuery,
	type ProjectSort,
	removeProjectMember,
	setProjectArchived,
	updateProject,
	updateProjectMemberRole,
} from "../services/project.service";

/**
 * Both parameters must be declared. Elysia validates the whole params object
 * and treats an undeclared key as an unexpected property, so omitting
 * `orgSlug` (which the tenant macro reads) would reject every request.
 */
const projectParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
});

const projectMemberParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	userId: t.String({ minLength: 1, maxLength: 64 }),
});

const projectQuery = t.Object({
	search: t.Optional(t.String({ maxLength: 100 })),
	status: t.Optional(t.String()),
	sort: t.Optional(t.String()),
	direction: t.Optional(t.String()),
	page: t.Optional(t.String()),
	pageSize: t.Optional(t.String()),
});

const PROJECT_STATUSES = ["all", "active", "archived"] as const;
const PROJECT_SORTS = ["name", "createdAt", "updatedAt"] as const;

/**
 * A batch of ids in one request.
 *
 * Capped at the same limit the members bulk routes use, so no single request
 * can turn into an unbounded loop.
 */
const idList = t.Array(t.String({ minLength: 1, maxLength: 64 }), {
	minItems: 1,
	maxItems: BULK_SELECTION_MAX,
});

/** Clamp query strings instead of trusting the browser. */
function parseProjectQuery(query: {
	search?: string;
	status?: string;
	sort?: string;
	direction?: string;
	page?: string;
	pageSize?: string;
}): ProjectListQuery {
	const status = (PROJECT_STATUSES as readonly string[]).includes(
		query.status ?? "",
	)
		? (query.status as "all" | "active" | "archived")
		: "active";

	const sort = (PROJECT_SORTS as readonly string[]).includes(query.sort ?? "")
		? (query.sort as ProjectSort)
		: "createdAt";

	const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
	const pageSize = Math.min(
		50,
		Math.max(10, Number.parseInt(query.pageSize ?? "20", 10) || 20),
	);

	return {
		search: query.search ?? "",
		status,
		sort,
		direction: query.direction === "asc" ? "asc" : "desc",
		page,
		pageSize,
	};
}

export const projectRoutes = new Elysia({ name: "projects" })
	.use(tenantPlugin)
	/** The projects page: rows, filter counts and the caller's capabilities. */
	.get(
		"/orgs/:orgSlug/projects",
		async ({ tenant, status, query }) => {
			try {
				return await listProjects(tenant, parseProjectQuery(query));
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the projects."),
				});
			}
		},
		{ tenant: true, query: projectQuery },
	)
	/** Create a project. Organization owners and admins only. */
	.post(
		"/orgs/:orgSlug/projects",
		async ({ tenant, status, body }) => {
			try {
				return await createProject(tenant, body);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not create the project."),
				});
			}
		},
		{
			tenant: true,
			body: t.Object({
				name: t.String({ minLength: 1, maxLength: 200 }),
				slug: t.String({ minLength: 1, maxLength: 100 }),
				description: t.Optional(t.String({ maxLength: 300 })),
				logo: t.Optional(t.String({ maxLength: 500 })),
			}),
		},
	)
	/** Project, members and viewer capabilities for the edit dialogs. */
	.get(
		"/orgs/:orgSlug/projects/:projectId",
		async ({ tenant, status, params }) => {
			try {
				return await getProjectDetail(tenant, params.projectId);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the project."),
				});
			}
		},
		{ tenant: true, params: projectParams },
	)
	/** Edit name, slug or logo. Project owners and admins only. */
	.patch(
		"/orgs/:orgSlug/projects/:projectId",
		async ({ tenant, status, params, body }) => {
			try {
				return await updateProject(tenant, params.projectId, body);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not update the project."),
				});
			}
		},
		{
			tenant: true,
			params: projectParams,
			body: t.Object({
				name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
				slug: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
				// An empty string clears the description, undefined leaves it.
				description: t.Optional(t.String({ maxLength: 300 })),
				// An empty string clears the logo, undefined leaves it untouched.
				logo: t.Optional(t.String({ maxLength: 500 })),
			}),
		},
	)
	/** Archive. Idempotent. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/archive",
		async ({ tenant, status, params }) => {
			try {
				return await setProjectArchived(tenant, params.projectId, true);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not archive the project."),
				});
			}
		},
		{ tenant: true, params: projectParams },
	)
	/** Restore an archived project. Idempotent. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/unarchive",
		async ({ tenant, status, params }) => {
			try {
				return await setProjectArchived(tenant, params.projectId, false);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not restore the project."),
				});
			}
		},
		{ tenant: true, params: projectParams },
	)
	/** Permanent delete. Project owners only. */
	.delete(
		"/orgs/:orgSlug/projects/:projectId",
		async ({ tenant, status, params }) => {
			try {
				return await deleteProject(tenant, params.projectId);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not delete the project."),
				});
			}
		},
		{ tenant: true, params: projectParams },
	)
	/** Archive several projects. Owners and admins. */
	.post(
		"/orgs/:orgSlug/projects/bulk-archive",
		async ({ tenant, status, body }) => {
			try {
				return await bulkSetProjectsArchived(tenant, body.projectIds, true);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not archive those projects."),
				});
			}
		},
		{ tenant: true, body: t.Object({ projectIds: idList }) },
	)
	/** Restore several archived projects. Owners and admins. */
	.post(
		"/orgs/:orgSlug/projects/bulk-unarchive",
		async ({ tenant, status, body }) => {
			try {
				return await bulkSetProjectsArchived(tenant, body.projectIds, false);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not restore those projects."),
				});
			}
		},
		{ tenant: true, body: t.Object({ projectIds: idList }) },
	)
	/** Permanently delete several projects. Project owners only, per item. */
	.post(
		"/orgs/:orgSlug/projects/bulk-delete",
		async ({ tenant, status, body }) => {
			try {
				return await bulkDeleteProjects(tenant, body.projectIds);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not delete those projects."),
				});
			}
		},
		{ tenant: true, body: t.Object({ projectIds: idList }) },
	)
	/** Add one workspace member to the project. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/members",
		async ({ tenant, status, params, body }) => {
			try {
				return await addProjectMember(
					tenant,
					params.projectId,
					body.userId,
					body.role as ProjectRole,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not add that person."),
				});
			}
		},
		{
			tenant: true,
			params: projectParams,
			body: t.Object({
				userId: t.String({ minLength: 1, maxLength: 64 }),
				role: t.UnionEnum(["owner", "admin", "member", "client"]),
			}),
		},
	)
	/** Add several workspace members in one request, with per person outcomes. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/members/bulk",
		async ({ tenant, status, params, body }) => {
			try {
				return await bulkAddProjectMembers(
					tenant,
					params.projectId,
					body.userIds,
					body.role as ProjectRole,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not add those people."),
				});
			}
		},
		{
			tenant: true,
			params: projectParams,
			body: t.Object({
				userIds: idList,
				role: t.UnionEnum(["owner", "admin", "member", "client"]),
			}),
		},
	)
	/** Remove several project members in one request, with per person outcomes. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/members/bulk-remove",
		async ({ tenant, status, params, body }) => {
			try {
				return await bulkRemoveProjectMembers(
					tenant,
					params.projectId,
					body.userIds,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not remove those people."),
				});
			}
		},
		{
			tenant: true,
			params: projectParams,
			body: t.Object({ userIds: idList }),
		},
	)
	/** Change one project member's role. */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/members/:userId",
		async ({ tenant, status, params, body }) => {
			try {
				return await updateProjectMemberRole(
					tenant,
					params.projectId,
					params.userId,
					body.role as ProjectRole,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not change that role."),
				});
			}
		},
		{
			tenant: true,
			params: projectMemberParams,
			body: t.Object({
				role: t.UnionEnum(["owner", "admin", "member", "client"]),
			}),
		},
	)
	/** Remove one project member. */
	.delete(
		"/orgs/:orgSlug/projects/:projectId/members/:userId",
		async ({ tenant, status, params }) => {
			try {
				return await removeProjectMember(
					tenant,
					params.projectId,
					params.userId,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not remove that person."),
				});
			}
		},
		{ tenant: true, params: projectMemberParams },
	);
