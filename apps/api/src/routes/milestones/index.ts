/**
 * Milestone routes.
 *
 * Why a separate file from `projects.ts`: projects.ts already carries the whole
 * project lifecycle and membership surface. Milestones are their own resource
 * with their own validation, and keeping them here means either file can be
 * read on its own.
 *
 * The routes only parse input and translate failures. Every rule lives in
 * `services/milestone/`, and the tenant macro guarantees `:orgSlug` was
 * resolved from a verified membership before a handler runs.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";
import {
	MILESTONE_ASSIGNEE_MAX,
	MILESTONE_SCOPE_TITLE_MAX,
	MILESTONE_TITLE_MAX,
} from "../../auth/milestone-permissions";
import { authErrorMessage, authErrorStatus } from "../../lib/auth-error";
import { tenantPlugin } from "../../middleware/tenant";
import {
	createMilestone,
	deleteMilestone,
	getMilestone,
	listMilestones,
	lockMilestone,
	setMilestoneAssignees,
	toggleMilestoneChecklist,
	unlockMilestone,
	updateMilestone,
} from "../../services/milestone";
import {
	getMilestoneScopeEntry,
	updateMilestoneScopeEntry,
} from "../../services/milestone/scope";
import { dispatchNotificationDeliveries } from "../../services/notification-dispatch.service";
import {
	parseMilestoneQuery,
	publishMilestoneCreated,
	publishMilestoneDeleted,
	publishMilestoneUpdated,
	publishScopeChanged,
} from "./events";
import {
	assigneeField,
	dateField,
	descriptionField,
	estimateField,
	milestoneParams,
	milestoneQuery,
	noteField,
	projectParams,
	scopeEntryParams,
	statusField,
} from "./schemas";

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
				const result = await createMilestone(tenant, params.projectId, body);

				publishMilestoneCreated(params.projectId, result.milestone);
				dispatchNotificationDeliveries(result.notifications);

				return {
					projectId: result.projectId,
					milestone: result.milestone,
					viewer: result.viewer,
				};
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
				statusNote: noteField,
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
				const result = await updateMilestone(
					tenant,
					params.projectId,
					params.milestoneId,
					body,
				);
				// `changed`, `timeline` and `notifications` are transport
				// metadata. The HTTP response stays the detail the editor
				// already expects.
				const { changed, timeline, notifications, ...detail } = result;

				// A no-op save returns an empty change list. Broadcasting it
				// would tell every open thread an edit happened, so the publish
				// is gated on actual change or a timeline row.
				if (changed.length > 0 || timeline.length > 0) {
					publishMilestoneUpdated(
						params.projectId,
						detail.milestone,
						changed,
						timeline,
					);
				}

				dispatchNotificationDeliveries(notifications);

				return detail;
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
				statusNote: noteField,
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
				const result = await setMilestoneAssignees(
					tenant,
					params.projectId,
					params.milestoneId,
					body.userIds,
				);
				// `changed`, `timeline` and `notifications` are transport
				// metadata. The HTTP response stays the detail the editor
				// already expects.
				const { changed, timeline, notifications, ...detail } = result;

				publishMilestoneUpdated(
					params.projectId,
					detail.milestone,
					changed,
					timeline,
				);
				dispatchNotificationDeliveries(notifications);

				return detail;
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
	/**
	 * Flip one scope checklist item.
	 *
	 * This is the one milestone write the lock does not stop: ticking an item is
	 * progress against the agreed document, not a change to its text.
	 */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/checklist",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await toggleMilestoneChecklist(
					tenant,
					params.projectId,
					params.milestoneId,
					body,
				);

				// A tick changes the body but no summary field, so the broadcast
				// carries its own field name. A reader with the locked scope open
				// refetches instead of showing a stale checkbox.
				publishMilestoneUpdated(
					params.projectId,
					result.milestone,
					["checklist"],
					[],
				);

				return result;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not update the checklist."),
				});
			}
		},
		{
			tenant: true,
			params: milestoneParams,
			body: t.Object({
				itemId: t.String({ minLength: 1, maxLength: 64 }),
				checked: t.Boolean(),
			}),
		},
	)
	/**
	 * Read one scope section including its full rich text body.
	 *
	 * The detail response carries only metadata, so a frozen round is fetched
	 * when it is expanded instead of on every milestone open.
	 */
	.get(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/scope/:entryId",
		async ({ tenant, status, params }) => {
			try {
				return await getMilestoneScopeEntry(
					tenant,
					params.projectId,
					params.milestoneId,
					params.entryId,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the scope section."),
				});
			}
		},
		{ tenant: true, params: scopeEntryParams },
	)
	/**
	 * Save the active test or review round, or correct an accepted section.
	 *
	 * The service owns the phase and role rules. This route only parses the
	 * field group and broadcasts the change.
	 */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/scope/:entryId",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await updateMilestoneScopeEntry(
					tenant,
					params.projectId,
					params.milestoneId,
					params.entryId,
					body,
				);
				const { notifications, ...entry } = result;

				publishScopeChanged(
					params.projectId,
					params.milestoneId,
					entry.id,
					tenant.userId,
				);
				dispatchNotificationDeliveries(notifications);

				return { scopeEntry: entry };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not save the scope section."),
				});
			}
		},
		{
			tenant: true,
			params: scopeEntryParams,
			body: t.Object({
				title: t.Optional(
					t.String({
						minLength: 1,
						maxLength: MILESTONE_SCOPE_TITLE_MAX,
					}),
				),
				body: descriptionField,
			}),
		},
	)
	/** Lock the milestone. Owner or admin only. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/lock",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await lockMilestone(
					tenant,
					params.projectId,
					params.milestoneId,
					body.reason,
				);
				const { changed, timeline, notifications, ...detail } = result;

				publishMilestoneUpdated(
					params.projectId,
					detail.milestone,
					changed,
					timeline,
				);
				dispatchNotificationDeliveries(notifications);

				return detail;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not lock the milestone."),
				});
			}
		},
		{
			tenant: true,
			params: milestoneParams,
			body: t.Object({ reason: noteField }),
		},
	)
	/** Unlock the milestone. Owner or admin only. The reason is optional. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/unlock",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await unlockMilestone(
					tenant,
					params.projectId,
					params.milestoneId,
					body.reason,
				);
				const { changed, timeline, notifications, ...detail } = result;

				publishMilestoneUpdated(
					params.projectId,
					detail.milestone,
					changed,
					timeline,
				);
				dispatchNotificationDeliveries(notifications);

				return detail;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not unlock the milestone."),
				});
			}
		},
		{
			tenant: true,
			params: milestoneParams,
			body: t.Object({ reason: noteField }),
		},
	)
	/** Permanently delete a milestone. */
	.delete(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId",
		async ({ tenant, status, params }) => {
			try {
				const result = await deleteMilestone(
					tenant,
					params.projectId,
					params.milestoneId,
				);

				publishMilestoneDeleted(params.projectId, params.milestoneId);

				return result;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not delete the milestone."),
				});
			}
		},
		{ tenant: true, params: milestoneParams },
	);
