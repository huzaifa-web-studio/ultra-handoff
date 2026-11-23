/**
 * Typed Eden calls for notifications and unread state.
 *
 * Why a feature API module: components never call the treaty client directly.
 * The request shape and error conversion live here, so a route change touches
 * one file.
 *
 * Used by: features/notifications/hooks.ts and features/milestones/comments.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";

export type NotificationFilter = "all" | "unread";

/** One page of the bell. */
export async function fetchNotifications(
	orgSlug: string,
	input: { cursor: string | null; filter: NotificationFilter },
) {
	const response = await api.orgs({ orgSlug }).notifications.get({
		query: {
			...(input.cursor ? { cursor: input.cursor } : {}),
			filter: input.filter,
		},
	});

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load your notifications."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

export type NotificationPage = Awaited<ReturnType<typeof fetchNotifications>>;
export type NotificationItem = NotificationPage["notifications"][number];

/** The badge and per project counts. */
export async function fetchNotificationSummary(orgSlug: string) {
	const response = await api.orgs({ orgSlug }).notifications.summary.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load your unread count."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

export type NotificationSummaryResponse = Awaited<
	ReturnType<typeof fetchNotificationSummary>
>;

/** Mark one notification read. */
export async function markNotificationRead(
	orgSlug: string,
	notificationId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.notifications({ notificationId })
		.read.post();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not mark that notification read."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

/** Mark everything the client has seen read. */
export async function markAllNotificationsRead(
	orgSlug: string,
	before: string,
) {
	const response = await api.orgs({ orgSlug }).notifications["read-all"].post({
		before,
	});

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not mark your notifications read."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

/** Whether this deployment can push, and the public key. */
export async function fetchPushConfig() {
	const response = await api.account.push.config.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load push settings."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

/** Register one browser push subscription. */
export async function savePushSubscription(input: {
	endpoint: string;
	p256dh: string;
	auth: string;
	userAgent?: string;
}) {
	const response = await api.account.push.subscriptions.post({
		endpoint: input.endpoint,
		keys: { p256dh: input.p256dh, auth: input.auth },
		userAgent: input.userAgent,
	});

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not enable desktop alerts."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

/** Remove one browser push subscription. */
export async function removePushSubscription(endpoint: string) {
	const response = await api.account.push.subscriptions.delete({ endpoint });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not disable desktop alerts."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

/** Unread comments grouped by milestone for one project. */
export async function fetchProjectUnread(orgSlug: string, projectId: string) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.comments.unread.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the unread count."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

export type ProjectUnreadResponse = Awaited<
	ReturnType<typeof fetchProjectUnread>
>;

/** Move the viewer's message cursor to the comments they just saw. */
export async function markCommentsRead(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
	commentIds: string[],
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.milestones({ milestoneId })
		.reads.post({ commentIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not update the read state."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return response.data;
}

export type MarkCommentsReadResponse = Awaited<
	ReturnType<typeof markCommentsRead>
>;
