/**
 * Notification reading.
 *
 * Why separate from the writer: the writer runs inside the actor's business
 * transaction and returns transport descriptors. This module runs on a request
 * scoped to the recipient and reads only that person's bell. Keeping them apart
 * also keeps the project visibility helper out of the write path, where it is
 * not needed.
 *
 * Every query here is subject to the notification RLS policy, so the explicit
 * `recipient_user_id` condition is a performance and clarity aid, not the only
 * protection. A forged notification id for another person simply updates zero
 * rows.
 *
 * Used by: src/routes/notifications.ts and the comment read service.
 */

import { APIError } from "better-auth/api";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
	changeRequest,
	comment,
	milestone,
	milestoneScopeEntry,
	notification,
	project,
} from "../db/schema";
import { type TenantTx, withTenant } from "../db/tenant";
import type {
	NotificationData,
	NotificationType,
} from "../lib/notification-types";
import {
	notificationPreview,
	type RenderedNotification,
	renderNotification,
} from "../lib/notifications";
import type { TenantContext } from "../middleware/tenant";
import { projectVisibility } from "./project.service";
import { loadUserMap } from "./user.service";

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

/** Decode a notification cursor, rejecting anything we did not produce. */
function decodeCursor(cursor: string): string | null {
	let decoded: string;

	try {
		decoded = Buffer.from(cursor, "base64url").toString("utf8");
	} catch {
		return null;
	}

	if (decoded.length === 0 || decoded.length > 128) return null;

	return decoded;
}

/** Encode one notification id as the next page cursor. */
function encodeCursor(id: string): string {
	return Buffer.from(id, "utf8").toString("base64url");
}

/** Normalise the JSON column, which is outside TypeScript once stored. */
function readData(value: unknown): NotificationData {
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
function organizationNameFromData(data: NotificationData): string | null {
	const value = data.organizationName;

	return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The shared WHERE conditions.
 *
 * `projectVisibility` is the same rule the project list uses, so a
 * notification about a project that was deleted, archived away or left cannot
 * appear while the project itself cannot be opened. Rows with no project, such
 * as an organization role change, skip the check.
 */
function notificationScope(tx: TenantTx, tenant: TenantContext) {
	return [
		eq(notification.organizationId, tenant.organizationId),
		eq(notification.recipientUserId, tenant.userId),
		or(isNull(notification.projectId), projectVisibility(tx, tenant)),
		// A soft deleted comment must not keep an unread mention alive. The row
		// stays for audit, but every read path hides it.
		or(isNull(notification.commentId), isNull(comment.deletedAt)),
		/**
		 * A reminder is true only for the due date it was sent for. When the
		 * date moves, the old unread reminder is hidden instead of pointing at
		 * a date the milestone no longer has. A completed milestone hides an
		 * unread reminder for the same reason.
		 */
		sql`not (
			${notification.type} in ('milestone_due_soon', 'milestone_overdue')
			and (
				(${milestone.dueDate})::text is distinct from (${notification.data} ->> 'dueDate')
				or (${notification.readAt} is null and ${milestone.status} in ('done', 'cancelled'))
			)
		)`,
	];
}

/** Build the select shape once so the list and count read the same joins. */
function notificationSelection() {
	return {
		id: notification.id,
		type: notification.type,
		readAt: notification.readAt,
		createdAt: notification.createdAt,
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

/**
 * Count unread notifications with the same filters as the list.
 *
 * The joins are required because visibility and reminder staleness depend on
 * the project, milestone and comment rows.
 */
async function countUnread(
	tx: TenantTx,
	tenant: TenantContext,
): Promise<number> {
	const [row] = await tx
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(notification)
		.leftJoin(project, eq(notification.projectId, project.id))
		.leftJoin(milestone, eq(notification.milestoneId, milestone.id))
		.leftJoin(comment, eq(notification.commentId, comment.id))
		.where(and(...notificationScope(tx, tenant), isNull(notification.readAt)));

	return row?.count ?? 0;
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
	const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

	if (query.cursor && !cursorId) {
		throw new APIError("BAD_REQUEST", {
			message: "That notifications page link is no longer valid.",
		});
	}

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const cursorClause = cursorId
				? sql`(${notification.createdAt}, ${notification.id}) < (
						select cursor_notification.created_at, cursor_notification.id
						from ${notification} as cursor_notification
						where cursor_notification.id = ${cursorId}
							and cursor_notification.recipient_user_id = ${tenant.userId}
					)`
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
					preview: commentView?.preview ?? null,
					data,
					...rendered,
				};
			});

			const unread = await countUnread(tx, tenant);

			return {
				notifications,
				unread,
				nextCursor:
					hasMore && page.length > 0
						? encodeCursor(page[page.length - 1]?.id as string)
						: null,
			};
		},
	);
}

/**
 * The bell badge and the per project dots.
 *
 * One grouped count, not one request per project. Only unread rows are counted,
 * and the result is filtered exactly like the list, so the badge can never be
 * larger than what the list would show.
 */
export async function getNotificationSummary(
	tenant: TenantContext,
): Promise<NotificationSummary> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const unread = await countUnread(tx, tenant);

			const rows = await tx
				.select({
					projectId: notification.projectId,
					count: sql<number>`count(*)`.mapWith(Number),
				})
				.from(notification)
				.leftJoin(project, eq(notification.projectId, project.id))
				.leftJoin(milestone, eq(notification.milestoneId, milestone.id))
				.leftJoin(comment, eq(notification.commentId, comment.id))
				.where(
					and(
						...notificationScope(tx, tenant),
						isNull(notification.readAt),
						sql`${notification.projectId} is not null`,
					),
				)
				.groupBy(notification.projectId);

			return {
				unread,
				byProject: rows.flatMap((row) =>
					row.projectId
						? [{ projectId: row.projectId, unread: row.count }]
						: [],
				),
			};
		},
	);
}

/**
 * Mark one notification read.
 *
 * Idempotent. A second call updates nothing and still returns the current
 * unread count, which is what the bell needs after a click.
 */
export async function markNotificationRead(
	tenant: TenantContext,
	notificationId: string,
): Promise<NotificationMarkResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const updated = await tx
				.update(notification)
				.set({ readAt: new Date() })
				.where(
					and(
						eq(notification.organizationId, tenant.organizationId),
						eq(notification.recipientUserId, tenant.userId),
						eq(notification.id, notificationId),
						isNull(notification.readAt),
					),
				)
				.returning({ id: notification.id });

			return {
				updated: updated.length,
				unread: await countUnread(tx, tenant),
			};
		},
	);
}

/**
 * Mark everything up to a cutoff read.
 *
 * The client sends the newest notification it has actually seen, not `now()`,
 * so a notification created during the click stays unread. A future timestamp
 * is clamped by the route before it reaches here.
 */
export async function markAllNotificationsRead(
	tenant: TenantContext,
	before: Date,
): Promise<NotificationMarkResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const updated = await tx
				.update(notification)
				.set({ readAt: new Date() })
				.where(
					and(
						eq(notification.organizationId, tenant.organizationId),
						eq(notification.recipientUserId, tenant.userId),
						isNull(notification.readAt),
						// Compare at millisecond precision. The client cutoff is a
						// JavaScript Date, while rows keep microseconds, so a row
						// in the same millisecond must still be included.
						sql`date_trunc('milliseconds', ${notification.createdAt}) <= ${sql.param(before, notification.createdAt)}`,
					),
				)
				.returning({ id: notification.id });

			return {
				updated: updated.length,
				unread: await countUnread(tx, tenant),
			};
		},
	);
}
