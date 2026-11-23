/**
 * Notification side effects.
 *
 * Why this module exists: creating a notification and delivering it are
 * different concerns. The write service returns descriptors after its
 * transaction commits, and this module hands them to the personal realtime
 * stream. Routes and background workers call the same function, so a reminder
 * and a comment mention travel through exactly one path.
 *
 * Publishing never throws into the caller. A Redis outage degrades realtime,
 * not the save that produced the notification. The stored row remains the
 * source of truth and the client refetches on reconnect or focus.
 *
 * Used by: notification creating routes, the reminder worker and the auth
 * hooks.
 */

import { enqueuePush } from "../queues/push";
import { publishUserEvent } from "../realtime";
import type { NotificationDelivery } from "./notification.service";

/**
 * Publish one realtime event per delivery.
 *
 * The payload is the delivery itself, including the rendered title, body and
 * href. That lets the browser show an operating system alert immediately
 * instead of fetching the row first, and it keeps the push and in-app copy
 * identical.
 */
export function dispatchNotificationDeliveries(
	deliveries: readonly NotificationDelivery[],
): void {
	for (const delivery of deliveries) {
		void publishUserEvent(
			delivery.organizationId,
			delivery.recipientUserId,
			"notification.created",
			delivery,
		).catch(() => undefined);

		// Push is a second channel, not a replacement. The service worker
		// suppresses the alert when a visible window already showed the event,
		// and a queue outage only loses the closed-tab copy.
		void enqueuePush({
			userId: delivery.recipientUserId,
			payload: {
				title: delivery.title,
				body: delivery.body,
				href: delivery.href,
				tag: delivery.notificationId,
				organizationSlug: delivery.organizationSlug,
			},
		}).catch(() => undefined);
	}
}

/**
 * Tell the same person's other tabs that a read action happened.
 *
 * The acting tab already has the response. This frame is what keeps a second
 * tab's badge from staying stale until its next refetch.
 */
export function dispatchNotificationRead(
	organizationId: string,
	userId: string,
	unread: number,
): void {
	void publishUserEvent(organizationId, userId, "notification.read", {
		unread,
	}).catch(() => undefined);
}

/**
 * Tell the same person's open tabs that a discussion cursor moved.
 *
 * The comments feature uses this to patch or invalidate its unread state in
 * another tab without polling.
 */
export function dispatchCommentRead(
	organizationId: string,
	userId: string,
	input: {
		projectId: string;
		milestoneId: string;
		rootCommentIds: string[];
		unreadTotal: number;
	},
): void {
	void publishUserEvent(organizationId, userId, "comment.read", input).catch(
		() => undefined,
	);
}
