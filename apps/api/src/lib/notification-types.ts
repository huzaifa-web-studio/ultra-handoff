/**
 * Notification vocabulary.
 *
 * Why this file is separate from the service: the database check constraint,
 * the notification service, the reminder sweep, the realtime payloads and the
 * web list all have to agree on the same closed set of type names. Keeping the
 * list in one pure module means a new type is added once and a typo is a type
 * error instead of a row the database refuses at runtime.
 *
 * This module has no database or HTTP imports on purpose. It is safe to import
 * from the schema, from services and from tests.
 *
 * Used by: src/db/schema.ts, services/notification.service.ts,
 * services/reminder.service.ts and src/lib/notifications.ts.
 */

/** Every notification this product can create. */
export const NOTIFICATION_TYPES = [
	/** A user mention in a comment, milestone description, scope entry or request. */
	"mention",
	/** A reply to the recipient's comment. */
	"comment_reply",
	/** A new root comment on a milestone the recipient follows. */
	"comment_new",
	/** The recipient was assigned to a milestone. */
	"milestone_assigned",
	/** A milestone the recipient follows changed status. */
	"milestone_status",
	/** The agreed scope was locked. */
	"scope_locked",
	/** The agreed scope was unlocked. */
	"scope_unlocked",
	/** A client raised a change request. */
	"change_request_created",
	/** A change request the recipient raised was decided. */
	"change_request_decided",
	/** A change request was withdrawn. */
	"change_request_withdrawn",
	/** The recipient was added to a project. */
	"project_member_added",
	/** The recipient's project role changed. */
	"project_role_changed",
	/** Someone accepted the recipient's organization invitation. */
	"member_joined",
	/** A milestone the recipient owns is due tomorrow or today. */
	"milestone_due_soon",
	/** A milestone the recipient owns is overdue. */
	"milestone_overdue",
	/** The recipient's organization role changed. */
	"org_role_changed",
	/** A project was archived. */
	"project_archived",
	/** A project was restored from the archive. */
	"project_unarchived",
	/**
	 * A new message in a conversation.
	 *
	 * Deliberately one row per conversation per recipient, refreshed on each
	 * new message, so a busy chat cannot flood the bell.
	 */
	"direct_message",
	/**
	 * A new message in a group channel.
	 *
	 * Same coalescing rule as a direct message, one row per channel per
	 * recipient. Kept as its own type so the copy can say which channel and so
	 * the list can render a channel name without guessing from the scope.
	 */
	"group_message",
] as const;

/** One notification type. */
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Small enum-like extras attached to a notification.
 *
 * Names, titles and previews are read from the joined business row instead of
 * being frozen here. This object only carries values that have no home in the
 * source row, such as a previous role, a decision or a due date phase.
 */
export type NotificationData = Record<string, string | number | boolean | null>;

/**
 * The SQL list used by the `notification_type_check` constraint.
 *
 * Written once so the schema and the runtime allowlist cannot drift.
 */
export const NOTIFICATION_TYPE_SQL_VALUES = NOTIFICATION_TYPES.map(
	(type) => `'${type}'`,
).join(", ");

/** True for a value this product writes. */
export function isNotificationType(value: unknown): value is NotificationType {
	return (
		typeof value === "string" &&
		(NOTIFICATION_TYPES as readonly string[]).includes(value)
	);
}

/** The notification types that point at a comment thread. */
export const COMMENT_NOTIFICATION_TYPES = [
	"mention",
	"comment_reply",
	"comment_new",
] as const;

/** True when the type points at a comment and can be cleared by reading it. */
export function isCommentNotificationType(
	type: NotificationType,
): type is (typeof COMMENT_NOTIFICATION_TYPES)[number] {
	return (COMMENT_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** The reminder types that can become stale when a due date moves. */
export const REMINDER_NOTIFICATION_TYPES = [
	"milestone_due_soon",
	"milestone_overdue",
] as const;
