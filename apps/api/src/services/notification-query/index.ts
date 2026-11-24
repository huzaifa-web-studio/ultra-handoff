/**
 * Public surface of the notification read module.
 *
 * Why: the notification routes and the comment read service should import one
 * entry point. Every name the old `notification-query/` exported is
 * re-exported here.
 *
 * Used by: `routes/notifications.ts` and `services/comment-read/`.
 */

export {
	decodeNotificationCursor,
	encodeNotificationCursor,
} from "./cursor";
export { listNotifications } from "./list";
export {
	markAllNotificationsRead,
	markNotificationRead,
} from "./mark";
export { getNotificationSummary } from "./summary";
export type {
	NotificationListQuery,
	NotificationListResult,
	NotificationMarkResult,
	NotificationRow,
	NotificationSummary,
} from "./types";
