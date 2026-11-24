/**
 * Change request routes.
 *
 * Why a separate file from `milestones.ts`: a change request has its own
 * lifecycle, its own validation and its own client actions. Keeping the two
 * files apart means either can be read on its own, exactly like `comments.ts`.
 *
 * The routes only parse input, translate failures and publish the transport
 * side effect. Every rule lives in `change-request.service.ts`, and the tenant
 * macro guarantees `:orgSlug` was resolved from a verified membership before a
 * handler runs.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import {
	CHANGE_REQUEST_STATUSES,
	CHANGE_REQUEST_TITLE_MAX,
} from "../auth/change-request-permissions";
import {
	MILESTONE_ASSIGNEE_MAX,
	MILESTONE_ESTIMATE_MAX,
	MILESTONE_NOTE_MAX,
	MILESTONE_SCOPE_TITLE_MAX,
	MILESTONE_STATUSES,
	MILESTONE_TITLE_MAX,
} from "../auth/milestone-permissions";
import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import { publishRealtimeEvent } from "../realtime";
import {
	type ChangeRequestRealtimePayload,
	type CommentRealtimePayload,
	type MilestoneCreatedPayload,
	type MilestoneScopeChangedPayload,
	toRealtimeChangeRequest,
	toRealtimeMilestone,
} from "../realtime/events";
import {
	createChangeRequest,
	listChangeRequests,
	moveChangeRequestToMilestone,
	updateChangeRequest,
} from "../services/change-request.service";
import type { MilestoneTimelineComment } from "../services/milestone";
import { dispatchNotificationDeliveries } from "../services/notification-dispatch.service";

/** Every change request route lives under one milestone. */
const milestoneParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	milestoneId: t.String({ minLength: 1, maxLength: 64 }),
});

/** One request inside a milestone. */
const changeParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	milestoneId: t.String({ minLength: 1, maxLength: 64 }),
	changeId: t.String({ minLength: 1, maxLength: 64 }),
});

/**
 * The editor value.
 *
 * Deliberately untyped at the HTTP layer: the shape is a Plate document, and
 * the sanitizer in the service is the authority on what is accepted.
 */
const bodyField = t.Optional(t.Unknown());

const dateField = t.Optional(t.Union([t.String({ maxLength: 10 }), t.Null()]));

const estimateField = t.Optional(
	t.Union([
		t.Integer({ minimum: 1, maximum: MILESTONE_ESTIMATE_MAX }),
		t.Null(),
	]),
);

const assigneeField = t.Optional(
	t.Array(t.String({ minLength: 1, maxLength: 64 }), {
		maxItems: MILESTONE_ASSIGNEE_MAX,
	}),
);

/**
 * One optional decision status.
 *
 * The explicit `default: undefined` matters for the same reason as the
 * milestone status field: a patch that only edits the body must not inject
 * `open` and look like a decision.
 */
const statusField = t.UnionEnum(CHANGE_REQUEST_STATUSES, {
	default: undefined,
});

const milestoneStatusField = t.UnionEnum(MILESTONE_STATUSES, {
	default: undefined,
});

/**
 * Publish one change request change.
 *
 * Why the route and not the service: the service owns rules, the route owns the
 * transport side effect, and the envelope needs the project id from the URL.
 * `publishRealtimeEvent` never rejects, so a realtime failure cannot turn a
 * successful save into an error.
 */
function publishChangeRequest(
	projectId: string,
	type: "change_request.created" | "change_request.updated",
	milestoneId: string,
	changeRequest: ChangeRequestRealtimePayload["changeRequest"],
	openCount: number,
): void {
	const payload: ChangeRequestRealtimePayload = {
		milestoneId,
		changeRequest,
		openCount,
	};

	void publishRealtimeEvent(projectId, type, payload).catch(() => undefined);
}

/**
 * Publish the activity rows a decision wrote.
 *
 * They ride the comment channel, so the discussion shows "declined ..." without
 * a refetch. An event is not a message, so `total` is null and the visible
 * comment count stays put.
 */
function publishTimeline(
	projectId: string,
	milestoneId: string,
	timeline: MilestoneTimelineComment[],
): void {
	for (const comment of timeline) {
		const payload: CommentRealtimePayload = {
			milestoneId,
			comment,
			total: null,
		};

		void publishRealtimeEvent(projectId, "comment.created", payload).catch(
			() => undefined,
		);
	}
}

export const changeRequestRoutes = new Elysia({ name: "change-requests" })
	.use(tenantPlugin)
	/** The full Changes tab payload, including the counts and the open badge. */
	.get(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/changes",
		async ({ tenant, status, params }) => {
			try {
				return await listChangeRequests(
					tenant,
					params.projectId,
					params.milestoneId,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not load the change requests.",
					),
				});
			}
		},
		{ tenant: true, params: milestoneParams },
	)
	/** Raise a request. Any project member, even when the milestone is locked. */
	.post(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/changes",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await createChangeRequest(
					tenant,
					params.projectId,
					params.milestoneId,
					body,
				);

				const { timeline, openCount, changeRequest } = result;

				publishChangeRequest(
					params.projectId,
					"change_request.created",
					params.milestoneId,
					toRealtimeChangeRequest(changeRequest),
					openCount,
				);
				publishTimeline(params.projectId, params.milestoneId, timeline);
				dispatchNotificationDeliveries(result.notifications);

				return { changeRequest, openCount };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not create the change request.",
					),
				});
			}
		},
		{
			tenant: true,
			params: milestoneParams,
			body: t.Object({
				title: t.String({ minLength: 1, maxLength: CHANGE_REQUEST_TITLE_MAX }),
				body: bodyField,
			}),
		},
	)
	/** Edit the text of an open request, or record a decision. */
	.patch(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/changes/:changeId",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await updateChangeRequest(
					tenant,
					params.projectId,
					params.milestoneId,
					params.changeId,
					body,
				);

				const { timeline, openCount, changeRequest, scopeEntry } = result;

				publishChangeRequest(
					params.projectId,
					"change_request.updated",
					params.milestoneId,
					toRealtimeChangeRequest(changeRequest),
					openCount,
				);
				publishTimeline(params.projectId, params.milestoneId, timeline);
				dispatchNotificationDeliveries(result.notifications);

				// An acceptance appends a scope section, so open panes refetch
				// that one section rather than the whole milestone detail.
				if (scopeEntry) {
					const payload: MilestoneScopeChangedPayload = {
						milestoneId: params.milestoneId,
						entryId: scopeEntry.id,
						updatedBy: tenant.userId,
					};

					void publishRealtimeEvent(
						params.projectId,
						"milestone.scope.changed",
						payload,
					).catch(() => undefined);
				}

				return { changeRequest, openCount, scopeEntry };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not save the change request.",
					),
				});
			}
		},
		{
			tenant: true,
			params: changeParams,
			body: t.Object({
				title: t.Optional(
					t.String({ minLength: 1, maxLength: CHANGE_REQUEST_TITLE_MAX }),
				),
				body: bodyField,
				status: t.Optional(statusField),
				note: t.Optional(
					t.Union([t.String({ maxLength: MILESTONE_NOTE_MAX }), t.Null()]),
				),
				// Only meaningful with status "accepted". The dialog sends the
				// final text so a partial acceptance is possible.
				scopeTitle: t.Optional(
					t.String({
						minLength: 1,
						maxLength: MILESTONE_SCOPE_TITLE_MAX,
					}),
				),
				scopeBody: bodyField,
			}),
		},
	)
	/**
	 * Create a milestone from a request.
	 *
	 * The dialog may override the prefilled title and body, and may set any of
	 * the normal milestone fields. The source milestone is never touched, so
	 * this works while it is locked.
	 */
	.post(
		"/orgs/:orgSlug/projects/:projectId/milestones/:milestoneId/changes/:changeId/to-milestone",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await moveChangeRequestToMilestone(
					tenant,
					params.projectId,
					params.milestoneId,
					params.changeId,
					body,
				);

				const { timeline, openCount, changeRequest, milestone } = result;

				publishChangeRequest(
					params.projectId,
					"change_request.updated",
					params.milestoneId,
					toRealtimeChangeRequest(changeRequest),
					openCount,
				);
				publishTimeline(params.projectId, params.milestoneId, timeline);
				dispatchNotificationDeliveries(result.notifications);

				// A move creates a milestone, so the list has to learn about it
				// even when the reader is not looking at the source milestone.
				const createdPayload: MilestoneCreatedPayload = {
					milestone: toRealtimeMilestone(milestone),
				};

				void publishRealtimeEvent(
					params.projectId,
					"milestone.created",
					createdPayload,
				).catch(() => undefined);

				return { changeRequest, openCount, milestone };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not move the change request.",
					),
				});
			}
		},
		{
			tenant: true,
			params: changeParams,
			body: t.Object({
				title: t.Optional(
					t.String({ minLength: 1, maxLength: MILESTONE_TITLE_MAX }),
				),
				description: t.Optional(t.Unknown()),
				status: t.Optional(milestoneStatusField),
				statusNote: t.Optional(
					t.Union([t.String({ maxLength: MILESTONE_NOTE_MAX }), t.Null()]),
				),
				startDate: dateField,
				dueDate: dateField,
				estimateMinutes: estimateField,
				assigneeUserIds: assigneeField,
			}),
		},
	);
