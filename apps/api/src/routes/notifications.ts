/**
 * Notification routes.
 *
 * Why a route of its own: the bell is workspace scoped but not project scoped.
 * It is read on the project list, settings, invitations and account-adjacent
 * pages, so it cannot live under a project resource.
 *
 * The tenant macro proves membership and a verified address before any handler
 * runs. The service then applies the recipient rule, and RLS repeats it in
 * Postgres. A forged notification id updates zero rows.
 *
 * Used by: src/index.ts.
 */

import { APIError } from "better-auth/api";
import { Elysia, t } from "elysia";

import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import { dispatchNotificationRead } from "../services/notification-dispatch.service";
import {
	getNotificationSummary,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	type NotificationListQuery,
} from "../services/notification-query.service";

/** Page size floor and ceiling. */
const NOTIFICATION_PAGE_DEFAULT = 20;
const NOTIFICATION_PAGE_MAX = 50;

/** Parse the list query without trusting the browser. */
function parseListQuery(query: {
	cursor?: string;
	limit?: string;
	filter?: string;
}): NotificationListQuery {
	const parsed = Number.parseInt(query.limit ?? "", 10);
	const limit = Number.isFinite(parsed)
		? Math.min(NOTIFICATION_PAGE_MAX, Math.max(1, parsed))
		: NOTIFICATION_PAGE_DEFAULT;

	return {
		cursor: query.cursor ?? null,
		limit,
		filter: query.filter === "unread" ? "unread" : "all",
	};
}

/**
 * Read the client supplied read-all cutoff.
 *
 * The client sends the newest notification it has actually seen. A future
 * timestamp is clamped to now so a clock skew cannot clear a notification that
 * has not arrived yet.
 */
function parseCutoff(value: string | undefined): Date {
	if (!value) return new Date();

	const parsed = new Date(value);

	if (Number.isNaN(parsed.getTime())) {
		throw new APIError("BAD_REQUEST", {
			message: "That read cutoff is not a valid date.",
		});
	}

	return parsed.getTime() > Date.now() ? new Date() : parsed;
}

export const notificationRoutes = new Elysia({ name: "notifications" })
	.use(tenantPlugin)
	/** One page of the bell, newest first. */
	.get(
		"/orgs/:orgSlug/notifications",
		async ({ tenant, status, query }) => {
			try {
				return await listNotifications(tenant, parseListQuery(query));
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not load your notifications.",
					),
				});
			}
		},
		{
			tenant: true,
			params: t.Object({
				orgSlug: t.String({ minLength: 1, maxLength: 255 }),
			}),
			query: t.Object({
				cursor: t.Optional(t.String({ maxLength: 200 })),
				limit: t.Optional(t.String()),
				filter: t.Optional(t.UnionEnum(["all", "unread"])),
			}),
		},
	)
	/** The unread badge and the per project dots. */
	.get(
		"/orgs/:orgSlug/notifications/summary",
		async ({ tenant, status }) => {
			try {
				return await getNotificationSummary(tenant);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load your unread count."),
				});
			}
		},
		{
			tenant: true,
			params: t.Object({
				orgSlug: t.String({ minLength: 1, maxLength: 255 }),
			}),
		},
	)
	/**
	 * Mark one notification read.
	 *
	 * Idempotent on purpose: a click and the later message read may both try to
	 * clear the same mention, and neither should surface an error.
	 */
	.post(
		"/orgs/:orgSlug/notifications/:notificationId/read",
		async ({ tenant, status, params }) => {
			try {
				const result = await markNotificationRead(
					tenant,
					params.notificationId,
				);

				dispatchNotificationRead(
					tenant.organizationId,
					tenant.userId,
					result.unread,
				);

				return result;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not mark that notification read.",
					),
				});
			}
		},
		{
			tenant: true,
			params: t.Object({
				orgSlug: t.String({ minLength: 1, maxLength: 255 }),
				notificationId: t.String({ minLength: 1, maxLength: 128 }),
			}),
		},
	)
	/** Mark everything the client has seen read, up to a cutoff. */
	.post(
		"/orgs/:orgSlug/notifications/read-all",
		async ({ tenant, status, body }) => {
			try {
				const result = await markAllNotificationsRead(
					tenant,
					parseCutoff(body.before),
				);

				dispatchNotificationRead(
					tenant.organizationId,
					tenant.userId,
					result.unread,
				);

				return result;
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not mark your notifications read.",
					),
				});
			}
		},
		{
			tenant: true,
			params: t.Object({
				orgSlug: t.String({ minLength: 1, maxLength: 255 }),
			}),
			body: t.Object({
				before: t.Optional(t.String({ maxLength: 40 })),
			}),
		},
	);
