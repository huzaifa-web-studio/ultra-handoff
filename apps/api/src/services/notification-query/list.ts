/**
 * Notification list and unread count.
 *
 * Why this file: the bell list and its unread badge read the same scope with
 * the same filters. Keeping them together means the badge can never disagree
 * with the page it labels.
 *
 * Used by: `routes/notifications.ts`.
 */

import { APIError } from "better-auth/api";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
	changeRequest,
	comment,
	milestone,
	milestoneScopeEntry,
	notification,
	project,
} from "../../db/schema";
import { type TenantTx, withTenant } from "../../db/tenant";
import type { NotificationType } from "../../lib/notification-types";
import {
	notificationPreview,
	renderNotification,
} from "../../lib/notifications";
import type { TenantContext } from "../../middleware/tenant";
import { loadUserMap } from "../user.service";
import { decodeNotificationCursor, encodeNotificationCursor } from "./cursor";
import {
	commentVisible,
	notificationBaseScope,
	notificationScope,
	notificationSelection,
	organizationNameFromData,
	REMINDER_TYPES,
	readData,
	reminderVisible,
} from "./scope";
import type {
	NotificationListQuery,
	NotificationListResult,
	NotificationRow,
} from "./types";

/**
 * Count unread notifications with the same filters as the list.
 *
 * Why the aggregate is split with FILTER: almost every unread row is an
 * ordinary notification with no comment and no reminder. Counting those with
 * no join to `comment` or `milestone` keeps the hot path on the unread partial
 * index. The two rare classes are guarded by their own column, so their EXISTS
 * is skipped for the rows that cannot be in them. One scan, one number.
 */
export async function countUnread(
	tx: TenantTx,
	tenant: TenantContext,
): Promise<number> {
	const reminderTypes = sql.raw(
		REMINDER_TYPES.map((type) => `'${type}'`).join(", "),
	);

	const [row] = await tx
		.select({
			bulk: sql<number>`count(*) filter (
				where ${notification.commentId} is null
					and ${notification.type} not in (${reminderTypes})
			)`.mapWith(Number),
			comments: sql<number>`count(*) filter (
				where ${notification.commentId} is not null
					and ${commentVisible()}
			)`.mapWith(Number),
			reminders: sql<number>`count(*) filter (
				where ${notification.type} in (${reminderTypes})
					and ${reminderVisible()}
			)`.mapWith(Number),
		})
		.from(notification)
		.leftJoin(project, eq(notification.projectId, project.id))
		.where(
			and(...notificationBaseScope(tx, tenant), isNull(notification.readAt)),
		);

	return (row?.bulk ?? 0) + (row?.comments ?? 0) + (row?.reminders ?? 0);
}

/**
 * One page of the bell, newest first.
 *
 * Keyset pagination through `(created_at, id)` keeps a notification arriving
 * while the reader scrolls from shifting the page or duplicating a row. The
 * cursor row is resolved inside Postgres, so the comparison uses the stored
 * timestamp rather than a JavaScript Date.
 */
export async function listNotifications(
	tenant: TenantContext,
	query: NotificationListQuery,
): Promise<NotificationListResult> {
	const cursor = query.cursor ? decodeNotificationCursor(query.cursor) : null;

	if (query.cursor && !cursor) {
		throw new APIError("BAD_REQUEST", {
			message: "That notifications page link is no longer valid.",
		});
	}

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const cursorClause = cursor
				? sql`(${notification.createdAt}, ${notification.id}) < (${cursor.createdAt}::timestamp, ${cursor.id})`
				: undefined;

			const rows = await tx
				.select(notificationSelection())
				.from(notification)
				.leftJoin(project, eq(notification.projectId, project.id))
				.leftJoin(milestone, eq(notification.milestoneId, milestone.id))
				.leftJoin(comment, eq(notification.commentId, comment.id))
				.leftJoin(
					changeRequest,
					eq(notification.changeRequestId, changeRequest.id),
				)
				.leftJoin(
					milestoneScopeEntry,
					eq(notification.scopeEntryId, milestoneScopeEntry.id),
				)
				.where(
					and(
						...notificationScope(tx, tenant),
						...(query.filter === "unread" ? [isNull(notification.readAt)] : []),
						...(cursorClause ? [cursorClause] : []),
					),
				)
				.orderBy(desc(notification.createdAt), desc(notification.id))
				.limit(query.limit + 1);

			const hasMore = rows.length > query.limit;
			const page = hasMore ? rows.slice(0, query.limit) : rows;
			const actorIds = [
				...new Set(
					page
						.map((row) => row.actorUserId)
						.filter((id): id is string => Boolean(id)),
				),
			];
			const people = await loadUserMap(actorIds);

			const notifications: NotificationRow[] = page.map((row) => {
				const data = readData(row.data);
				const actor = row.actorUserId ? people.get(row.actorUserId) : undefined;
				const projectView =
					row.projectId && row.projectName && row.projectSlug
						? {
								id: row.projectId,
								name: row.projectName,
								slug: row.projectSlug,
							}
						: null;
				const milestoneView =
					row.milestoneId && row.milestoneTitle
						? { id: row.milestoneId, title: row.milestoneTitle }
						: null;
				const commentView =
					row.commentId !== null
						? {
								id: row.commentId,
								parentId: row.commentParentId ?? null,
								preview: notificationPreview(row.commentPreview),
							}
						: null;
				const changeRequestView =
					row.changeRequestId && row.changeRequestTitle
						? { id: row.changeRequestId, title: row.changeRequestTitle }
						: null;
				const scopeEntryView =
					row.scopeEntryId && row.scopeEntryTitle
						? { id: row.scopeEntryId, title: row.scopeEntryTitle }
						: null;

				const rendered = renderNotification({
					type: row.type as NotificationType,
					actorName: actor ? actor.name || actor.email : null,
					organizationSlug: tenant.slug,
					organizationName: organizationNameFromData(data),
					project: projectView,
					milestone: milestoneView,
					comment: commentView,
					changeRequest: changeRequestView,
					scopeEntry: scopeEntryView,
					conversation: row.conversationId ? { id: row.conversationId } : null,
					data,
				});

				return {
					id: row.id,
					type: row.type as NotificationType,
					readAt: row.readAt ? row.readAt.toISOString() : null,
					createdAt: row.createdAt.toISOString(),
					actor: row.actorUserId
						? {
								id: row.actorUserId,
								name: actor?.name || actor?.email || "Former member",
								image: actor?.image ?? null,
							}
						: null,
					project: projectView,
					milestone: milestoneView,
					commentId: row.commentId,
					threadCommentId: commentView
						? (commentView.parentId ?? commentView.id)
						: null,
					changeRequestId: row.changeRequestId,
					scopeEntryId: row.scopeEntryId,
					conversationId: row.conversationId,
					preview: commentView?.preview ?? null,
					data,
					...rendered,
				};
			});

			const unread = await countUnread(tx, tenant);
			const last = page[page.length - 1];

			return {
				notifications,
				unread,
				nextCursor:
					hasMore && last
						? encodeNotificationCursor(last.createdAtText, last.id)
						: null,
			};
		},
	);
}
