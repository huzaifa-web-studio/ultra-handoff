/**
 * Milestone routes.
 *
 * Why a separate file from `projects.ts`: projects.ts already carries the whole
 * project lifecycle and membership surface. Milestones are their own resource
 * with their own validation, and keeping them here means either file can be
 * read on its own.
 *
 * The routes only parse input and translate failures. Every rule lives in
 * `milestone.service.ts`, and the tenant macro guarantees `:orgSlug` was
 * resolved from a verified membership before a handler runs.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import {
	MILESTONE_ASSIGNEE_MAX,
	MILESTONE_ESTIMATE_MAX,
	MILESTONE_STATUSES,
	MILESTONE_TITLE_MAX,
} from "../auth/milestone-permissions";
import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import {
	createMilestone,
	deleteMilestone,
	getMilestone,
	listMilestones,
	type MilestoneListQuery,
	setMilestoneAssignees,
	updateMilestone,
} from "../services/milestone.service";

/** Every milestone route lives under one project. */
const milestoneParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	milestoneId: t.String({ minLength: 1, maxLength: 64 }),
});

/** Params for the collection routes, which have no milestone id yet. */
const projectParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
});

const milestoneQuery = t.Object({
	search: t.Optional(t.String({ maxLength: 100 })),
	status: t.Optional(t.String()),
	sort: t.Optional(t.String()),
	direction: t.Optional(t.String()),
	page: t.Optional(t.String()),
	pageSize: t.Optional(t.String()),
});

/**
 * A date arrives as `YYYY-MM-DD`, an empty string or null.
 *
 * The empty string is how the client clears a field through PATCH, matching
 * the convention the project routes already use for descriptions and logos.
 */
const dateField = t.Optional(t.Union([t.String({ maxLength: 10 }), t.Null()]));

const estimateField = t.Optional(
	t.Union([
		t.Integer({ minimum: 1, maximum: MILESTONE_ESTIMATE_MAX }),
		t.Null(),
	]),
);

/**
 * The editor value.
 *
 * Deliberately untyped at the HTTP layer: the shape is a Plate document, and
 * the sanitizer in the service is the authority on what is accepted. A schema
 * here would have to be duplicated and kept in sync with the editor.
 */
const descriptionField = t.Optional(t.Unknown());

const assigneeField = t.Optional(
	t.Array(t.String({ minLength: 1, maxLength: 64 }), {
		maxItems: MILESTONE_ASSIGNEE_MAX,
	}),
);

/**
 * One optional status value.
 *
 * Why the explicit `default: undefined`: `t.UnionEnum` normally injects the
 * first enum value when the property is missing, so a PATCH that only changed a
 * date silently reset the status to "todo". Overriding the helper's default
 * keeps a missing status missing while preserving the inferred union type.
 */
const statusField = t.UnionEnum(MILESTONE_STATUSES, { default: undefined });

const MILESTONE_SORTS = ["dueDate", "createdAt", "title"] as const;

const MILESTONE_FILTERS = ["all", "active", ...MILESTONE_STATUSES] as const;

/** Clamp the query strings instead of trusting the browser. */
function parseMilestoneQuery(query: {
	search?: string;
	status?: string;
	sort?: string;
	direction?: string;
	page?: string;
	pageSize?: string;
}): MilestoneListQuery {
	const status = (MILESTONE_FILTERS as readonly string[]).includes(
		query.status ?? "",
	)
		? (query.status as MilestoneListQuery["status"])
		: "active";

	const sort = (MILESTONE_SORTS as readonly string[]).includes(query.sort ?? "")
		? (query.sort as MilestoneListQuery["sort"])
		: "dueDate";

	const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
	const pageSize = Math.min(
		50,
		Math.max(10, Number.parseInt(query.pageSize ?? "25", 10) || 25),
	);

	return {
		search: query.search ?? "",
		status,
		sort,
		direction: query.direction === "desc" ? "desc" : "asc",
		page,
		pageSize,
	};
}

export const milestoneRoutes = new Elysia({ name: "milestones" })
	.use(tenantPlugin)
	/** The list, its counts and the caller's capabilities. */
	.get(
		"/orgs/:orgSlug/projects/:projectId/milestones",
		async ({ tenant, status, params, query }) => {
			try {
				return await listMilestones(
					tenant,
					params.projectId,
					parseMilestoneQuery(query),
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the milestones."),
				});
			}
		},
		{ tenant: true, params: projectParams, query: milestoneQuery },
	)
	/** Create a milestone. Owners, admins and members only. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/milestones",
		async ({ tenant, status, params, body }) => {
			try {
				return await createMilestone(tenant, params.projectId, body);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not create the milestone."),
				});
			}
		},
		{
			tenant: true,
			params: projectParams,
			body: t.Object({
				title: t.String({ minLength: 1, maxLength: MILESTONE_TITLE_MAX }),
				status: t.Optional(statusField),
				description: descriptionField,
				startDate: dateField,
				dueDate: dateField,
				estimateMinutes: estimateField,
				assigneeUserIds: assigneeField,
			}),
		},
	)
	/** One milestone with the full editor document. */
	.get(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId",
		async ({ tenant, status, params }) => {
			try {
				return await getMilestone(tenant, params.projectId, params.milestoneId);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the milestone."),
				});
			}
		},
		{ tenant: true, params: milestoneParams },
	)
	/**
	 * Update any subset of fields.
	 *
	 * This is the autosave endpoint: the client sends only the field group that
	 * changed, so two tabs editing different fields cannot overwrite each other.
	 */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId",
		async ({ tenant, status, params, body }) => {
			try {
				return await updateMilestone(
					tenant,
					params.projectId,
					params.milestoneId,
					body,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not save the milestone."),
				});
			}
		},
		{
			tenant: true,
			params: milestoneParams,
			body: t.Object({
				title: t.Optional(
					t.String({ minLength: 1, maxLength: MILESTONE_TITLE_MAX }),
				),
				status: t.Optional(statusField),
				description: descriptionField,
				startDate: dateField,
				dueDate: dateField,
				estimateMinutes: estimateField,
				assigneeUserIds: assigneeField,
			}),
		},
	)
	/**
	 * Replace the assignee set.
	 *
	 * A PUT because the picker always sends the complete selection, which makes
	 * the call idempotent and impossible to partially apply.
	 */
	.put(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/assignees",
		async ({ tenant, status, params, body }) => {
			try {
				return await setMilestoneAssignees(
					tenant,
					params.projectId,
					params.milestoneId,
					body.userIds,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not update the assignees."),
				});
			}
		},
		{
			tenant: true,
			params: milestoneParams,
			body: t.Object({
				userIds: t.Array(t.String({ minLength: 1, maxLength: 64 }), {
					maxItems: MILESTONE_ASSIGNEE_MAX,
				}),
			}),
		},
	)
	/** Permanently delete a milestone. */
	.delete(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId",
		async ({ tenant, status, params }) => {
			try {
				return await deleteMilestone(
					tenant,
					params.projectId,
					params.milestoneId,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not delete the milestone."),
				});
			}
		},
		{ tenant: true, params: milestoneParams },
	);
