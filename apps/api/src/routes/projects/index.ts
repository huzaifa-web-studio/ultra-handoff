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
import type { ProjectRole } from "../../auth/project-permissions";
import { authErrorMessage, authErrorStatus } from "../../lib/auth-error";
import { tenantPlugin } from "../../middleware/tenant";
import { dispatchNotificationDeliveries } from "../../services/notification-dispatch.service";
import {
	addProjectMember,
	bulkAddProjectMembers,
	bulkDeleteProjects,
	bulkRemoveProjectMembers,
	bulkSetProjectsArchived,
	createProject,
	deleteProject,
	getProjectDetail,
	getProjectDetailBySlug,
	getSidebarProjects,
	listProjects,
	removeProjectMember,
	setProjectArchived,
	setProjectArchiveVisibility,
	setProjectPinned,
	updateProject,
	updateProjectMemberRole,
} from "../../services/project";
import { parseProjectQuery } from "./query";
import {
	idList,
	projectMemberParams,
	projectParams,
	projectQuery,
	projectSlugParams,
} from "./schemas";

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
	/**
	 * Sidebar payload: the caller's pinned projects.
	 *
	 * Registered before the `:projectId` detail route on purpose, so "sidebar"
	 * is never mistaken for an id. Elysia prefers static segments anyway, but
	 * the order makes the intent explicit.
	 */
	.get(
		"/orgs/:orgSlug/projects/sidebar",
		async ({ tenant, status }) => {
			try {
				return await getSidebarProjects(tenant);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load your projects."),
				});
			}
		},
		{ tenant: true },
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
	/**
	 * The readable project page lookup.
	 *
	 * Why a separate path: the URL uses the slug, while every mutation and the
	 * dialogs keep using the immutable id. `by-slug` is a static segment, so
	 * the router takes that branch and never mistakes it for an id.
	 */
	.get(
		"/orgs/:orgSlug/projects/by-slug/:projectSlug",
		async ({ tenant, status, params }) => {
			try {
				return await getProjectDetailBySlug(tenant, params.projectSlug);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the project."),
				});
			}
		},
		{ tenant: true, params: projectSlugParams },
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
	/**
	 * Pin or unpin a project in the caller's sidebar.
	 *
	 * A PATCH with a boolean instead of POST/DELETE because the two directions
	 * are one idempotent upsert, and the client always knows the target state.
	 */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/pin",
		async ({ tenant, status, params, body }) => {
			try {
				return await setProjectPinned(tenant, params.projectId, body.pinned);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not update the pin."),
				});
			}
		},
		{
			tenant: true,
			params: projectParams,
			body: t.Object({ pinned: t.Boolean() }),
		},
	)
	/** Archive. Idempotent. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/archive",
		async ({ tenant, status, params }) => {
			try {
				const result = await setProjectArchived(tenant, params.projectId, true);
				dispatchNotificationDeliveries(result.notifications);

				return { status: result.status, archivedAt: result.archivedAt };
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
				const result = await setProjectArchived(
					tenant,
					params.projectId,
					false,
				);
				dispatchNotificationDeliveries(result.notifications);

				return { status: result.status, archivedAt: result.archivedAt };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not restore the project."),
				});
			}
		},
		{ tenant: true, params: projectParams },
	)
	/**
	 * Keep an archived project visible to its clients.
	 *
	 * Separate from PATCH /projects/:projectId because that route is locked
	 * while the project is archived, and this is the one setting that must stay
	 * editable in both states.
	 */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/archive-visibility",
		async ({ tenant, status, params, body }) => {
			try {
				return await setProjectArchiveVisibility(
					tenant,
					params.projectId,
					body.visibleToClient,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not change the archive visibility.",
					),
				});
			}
		},
		{
			tenant: true,
			params: projectParams,
			body: t.Object({ visibleToClient: t.Boolean() }),
		},
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
				const result = await bulkSetProjectsArchived(
					tenant,
					body.projectIds,
					true,
				);
				dispatchNotificationDeliveries(result.notifications);

				return { results: result.results };
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
				const result = await bulkSetProjectsArchived(
					tenant,
					body.projectIds,
					false,
				);
				dispatchNotificationDeliveries(result.notifications);

				return { results: result.results };
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
				const result = await addProjectMember(
					tenant,
					params.projectId,
					body.userId,
					body.role as ProjectRole,
				);
				dispatchNotificationDeliveries(result.notifications);

				return { userId: result.userId, role: result.role };
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
				const result = await bulkAddProjectMembers(
					tenant,
					params.projectId,
					body.userIds,
					body.role as ProjectRole,
				);
				dispatchNotificationDeliveries(result.notifications);

				return { results: result.results };
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
				const result = await updateProjectMemberRole(
					tenant,
					params.projectId,
					params.userId,
					body.role as ProjectRole,
				);
				dispatchNotificationDeliveries(result.notifications);

				return { userId: result.userId, role: result.role };
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
