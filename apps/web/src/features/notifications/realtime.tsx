"use client";

/**
 * Personal realtime provider.
 *
 * Why this is mounted at the app shell: notifications arrive on the project
 * list, settings, invitations and the notifications page itself. A project
 * scoped socket cannot carry them, so this provider owns the user scoped stream
 * for the active workspace.
 *
 * The stream is an accelerator, never the source of truth. Every event
 * invalidates the relevant query, so a dropped frame, a reconnect or a Redis
 * outage is recovered by the next read.
 *
 * Used by: routes/_app.tsx (mounted around the shell), the bell and the
 * comments feature.
 */

import type {
	CommentReadPayload,
	NotificationCreatedPayload,
	NotificationReadPayload,
	RealtimeEnvelope,
} from "@org/api";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect } from "react";

import {
	acquireUserRealtimeSocket,
	type RealtimeStatus,
} from "#/lib/realtime/socket";
import {
	hasDesktopOptIn,
	isAwayFromApp,
	showDesktopNotification,
} from "./desktop";
import {
	notificationSummaryKey,
	notificationsKey,
	projectUnreadKey,
} from "./hooks";
import { enablePush, registerServiceWorker } from "./push";

/** Read a personal event into a narrow shape. */
function readCreated(
	event: RealtimeEnvelope,
): NotificationCreatedPayload | null {
	if (event.type !== "notification.created") return null;

	const data = event.data;

	if (!data || typeof data !== "object" || Array.isArray(data)) return null;

	const record = data as Record<string, unknown>;

	if (typeof record.notificationId !== "string") return null;
	if (typeof record.title !== "string") return null;
	if (typeof record.body !== "string") return null;
	if (typeof record.href !== "string") return null;

	return record as NotificationCreatedPayload;
}

function readUnread(event: RealtimeEnvelope): NotificationReadPayload | null {
	if (event.type !== "notification.read") return null;

	const data = event.data;

	if (!data || typeof data !== "object" || Array.isArray(data)) return null;

	const unread = (data as Record<string, unknown>).unread;

	return typeof unread === "number" ? { unread } : null;
}

function readCommentRead(event: RealtimeEnvelope): CommentReadPayload | null {
	if (event.type !== "comment.read") return null;

	const data = event.data;

	if (!data || typeof data !== "object" || Array.isArray(data)) return null;

	const record = data as Record<string, unknown>;

	if (typeof record.projectId !== "string") return null;
	if (typeof record.milestoneId !== "string") return null;
	if (!Array.isArray(record.rootCommentIds)) return null;
	if (typeof record.unreadTotal !== "number") return null;

	return record as CommentReadPayload;
}

/**
 * One user scoped connection per workspace and person.
 *
 * The connection is headless. It never renders anything and never owns list
 * state; it only invalidates the queries that do.
 */
export function NotificationRealtimeProvider({
	orgSlug,
	userId,
	children,
}: {
	orgSlug: string;
	userId: string;
	children: ReactNode;
}) {
	const queryClient = useQueryClient();

	// Register early so a push can arrive on a later page load even before the
	// person opens the notification settings card.
	useEffect(() => {
		void registerServiceWorker();
	}, []);

	// A browser may rotate or invalidate its push subscription. Re-subscribe
	// from any page, not only when the settings card happens to be open.
	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;

		const handler = (event: MessageEvent) => {
			if (event.data?.type !== "handoff:push-subscription-changed") return;
			if (!hasDesktopOptIn()) return;

			void enablePush().catch(() => undefined);
		};

		navigator.serviceWorker.addEventListener("message", handler);

		return () => {
			navigator.serviceWorker.removeEventListener("message", handler);
		};
	}, []);

	useEffect(() => {
		if (!orgSlug || !userId) return;

		const lease = acquireUserRealtimeSocket(orgSlug, userId);
		let previousStatus: RealtimeStatus = lease.socket.getStatus();

		const offStatus = lease.socket.onStatus((status) => {
			const wasOpen = previousStatus === "open";
			previousStatus = status;

			// A reconnect can miss frames. Refetch once the stream is proving
			// itself again so the badge and the list catch up.
			if (status === "open" && !wasOpen) {
				void queryClient.invalidateQueries({
					queryKey: notificationsKey(orgSlug),
				});
			}
		});

		const offEvent = lease.socket.onEvent((event) => {
			const created = readCreated(event);

			if (created) {
				void queryClient.invalidateQueries({
					queryKey: notificationSummaryKey(orgSlug),
				});
				void queryClient.invalidateQueries({
					queryKey: [...notificationsKey(orgSlug), "list"],
				});

				if (hasDesktopOptIn() && isAwayFromApp()) {
					showDesktopNotification({
						title: created.title,
						body: created.body,
						href: created.href,
						tag: created.notificationId,
					});
				}

				return;
			}

			const unread = readUnread(event);

			if (unread) {
				queryClient.setQueryData(
					notificationSummaryKey(orgSlug),
					(current: { unread: number } | undefined) =>
						current ? { ...current, unread: unread.unread } : current,
				);
				void queryClient.invalidateQueries({
					queryKey: [...notificationsKey(orgSlug), "list"],
				});
				return;
			}

			const commentRead = readCommentRead(event);

			if (commentRead) {
				void queryClient.invalidateQueries({
					queryKey: projectUnreadKey(orgSlug, commentRead.projectId),
				});
				void queryClient.invalidateQueries({
					queryKey: [
						"organization",
						orgSlug,
						"milestones",
						commentRead.projectId,
					],
				});
				// Reading a thread can clear mention and reply notifications.
				void queryClient.invalidateQueries({
					queryKey: notificationsKey(orgSlug),
				});
			}
		});

		return () => {
			offEvent();
			offStatus();
			lease.release();
		};
	}, [orgSlug, userId, queryClient]);

	return <>{children}</>;
}
