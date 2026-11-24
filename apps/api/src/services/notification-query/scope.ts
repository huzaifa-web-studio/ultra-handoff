/**
 * Notification visibility scope.
 *
 * Why this file: a notification is hidden when its project is hidden or when
 * its comment or reminder is no longer visible. The list, the unread count and
 * the mark writes all have to apply the same rule, so it lives here.
 *
 * Used by: the read and write modules in `services/notification-query/`.
 */

import { eq, isNull, or, sql } from "drizzle-orm";
import {
	changeRequest,
	comment,
	milestone,
	milestoneScopeEntry,
	notification,
	project,
} from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { NotificationData } from "../../lib/notification-types";
import type { TenantContext } from "../../middleware/tenant";
import { projectVisibility } from "../project";

/** Normalise the JSON column, which is outside TypeScript once stored. */
export function readData(value: unknown): NotificationData {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	const result: NotificationData = {};

	for (const [key, item] of Object.entries(value)) {
		if (
			typeof item === "string" ||
			typeof item === "number" ||
			typeof item === "boolean" ||
			item === null
		) {
			result[key] = item;
		}
	}

	return result;
}

/** The organization name stored on organization-level rows. */
export function organizationNameFromData(
	data: NotificationData,
): string | null {
	const value = data.organizationName;

	return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reminder types whose copy depends on the milestone's current due date. */
export const REMINDER_TYPES = [
	"milestone_due_soon",
	"milestone_overdue",
] as const;

/**
 * The conditions every read shares.
 *
 * Why this is separate from visibility: these three conditions do not need a
 * join to `comment` or `milestone`, so the unread count can apply them with a
 * single scan of `notification` plus `project`. The rare row classes then add
 * their own EXISTS below.
 */
export function notificationBaseScope(tx: TenantTx, tenant: TenantContext) {
	return [
		eq(notification.organizationId, tenant.organizationId),
		eq(notification.recipientUserId, tenant.userId),
		or(isNull(notification.projectId), projectVisibility(tx, tenant)),
	];
}

/**
 * A notification whose comment was soft deleted is hidden.
 *
 * The `is null` guard is inside the predicate, not only in the caller: Postgres
 * short-circuits `OR`, so an ordinary notification never runs the EXISTS. That
 * is what keeps the count and the grouped summary off the `comment` table.
 */
export function commentVisible() {
	return sql`(
		${notification.commentId} is null
		or not exists (
			select 1 from ${comment} as visible_comment
			where visible_comment.id = ${notification.commentId}
				and visible_comment.deleted_at is not null
		)
	)`;
}

/**
 * A reminder is true only for the due date it was sent for.
 *
 * When the date moves, the old reminder is hidden instead of pointing at a date
 * the milestone no longer has. A completed milestone hides an unread reminder
 * for the same reason. The read check is part of the rule because a read row is
 * history and stays visible after completion.
 *
 * The type guard comes first for the same reason as `commentVisible`: the
 * common row never touches `milestone`.
 */
export function reminderVisible() {
	return sql`(
		${notification.type} not in ('milestone_due_soon', 'milestone_overdue')
		or exists (
			select 1 from ${milestone} as current_milestone
			where current_milestone.id = ${notification.milestoneId}
				and current_milestone.due_date::text is not distinct from (${notification.data} ->> 'dueDate')
				and (
					current_milestone.status not in ('done', 'cancelled')
					or ${notification.readAt} is not null
				)
		)
	)`;
}

/**
 * The shared visibility predicate.
 *
 * `projectVisibility` is the same rule the project list uses, so a notification
 * about a project that was deleted, archived away or left cannot appear while
 * the project itself cannot be opened. Rows with no project, such as an
 * organization role change, skip that check.
 *
 * Why EXISTS for the rare cases: before this, the count joined `comment` and
 * `milestone` once per unread row, which showed up as 20,000 sequential scans
 * at 20,000 unread. The classes that need those tables are now guarded by their
 * own column, so the common row never touches them.
 */
export function notificationScope(tx: TenantTx, tenant: TenantContext) {
	return [
		...notificationBaseScope(tx, tenant),
		commentVisible(),
		reminderVisible(),
	];
}

/** Build the select shape once so the list and count read the same joins. */
export function notificationSelection() {
	return {
		id: notification.id,
		type: notification.type,
		readAt: notification.readAt,
		createdAt: notification.createdAt,
		// The cursor needs the exact stored value, including microseconds.
		createdAtText: sql<string>`${notification.createdAt}::text`,
		actorUserId: notification.actorUserId,
		projectId: notification.projectId,
		milestoneId: notification.milestoneId,
		commentId: notification.commentId,
		changeRequestId: notification.changeRequestId,
		scopeEntryId: notification.scopeEntryId,
		data: notification.data,
		projectName: project.name,
		projectSlug: project.slug,
		milestoneTitle: milestone.title,
		commentParentId: comment.parentId,
		commentPreview: sql<string | null>`left(${comment.bodyText}, 160)`,
		changeRequestTitle: changeRequest.title,
		scopeEntryTitle: milestoneScopeEntry.title,
	};
}
