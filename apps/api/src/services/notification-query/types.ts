/**
 * Notification read shapes.
 *
 * Why this file: the route and every read module name the same row, list and
 * summary shapes, so they live together.
 *
 * Used by: the modules in `services/notification-query/`.
 */

import type {
	NotificationData,
	NotificationType,
} from "../../lib/notification-types";
import type { RenderedNotification } from "../../lib/notifications";

/** One notification as the bell and the list render it. */
export type NotificationRow = RenderedNotification & {
	id: string;
	type: NotificationType;
	readAt: string | null;
	createdAt: string;
	actor: { id: string; name: string; image: string | null } | null;
	project: { id: string; name: string; slug: string } | null;
	milestone: { id: string; title: string } | null;
	commentId: string | null;
	threadCommentId: string | null;
	changeRequestId: string | null;
	scopeEntryId: string | null;
	preview: string | null;
	data: NotificationData;
};

/** One page of the bell. */
export type NotificationListResult = {
	notifications: NotificationRow[];
	unread: number;
	nextCursor: string | null;
};

/** The badge and the per project counts. */
export type NotificationSummary = {
	unread: number;
	byProject: { projectId: string; unread: number }[];
};

/** Normalised list input, already clamped by the route. */
export type NotificationListQuery = {
	cursor: string | null;
	limit: number;
	filter: "all" | "unread";
};

/** The result of one mark action. */
export type NotificationMarkResult = {
	updated: number;
	unread: number;
};

/**
 * A notification cursor.
 *
 * Why it carries the position rather than a row id: a keyset that resolves the
 * row by id silently returns an empty page when that row was deleted, which
 * ends the list for the reader. The timestamp text and the id are enough to
 * resume from the same point without the row existing.
 *
 * `createdAt` is read as text from Postgres so microseconds survive. Truncating
 * to a JavaScript Date would lose them and repeat or skip rows that share a
 * millisecond.
 */
export type NotificationCursor = {
	createdAt: string;
	id: string;
};
