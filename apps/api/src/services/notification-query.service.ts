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
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
type NotificationCursor = {
	createdAt: string;
	id: string;
};

/** Six fractional digits at most, matching the column. */
const CURSOR_TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

/** Notifications use UUID primary keys. */
const CURSOR_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decode a notification cursor, rejecting anything we did not produce.
 *
 * `Buffer.from(value, "base64url")` never throws for a string, so validation
 * has to happen after decoding. The cursor is not a security boundary, because
 * every query is still scoped to the recipient and the organization; a forged
 * valid cursor only changes where the person starts reading their own list.
 */
export function decodeNotificationCursor(
	cursor: string,
): NotificationCursor | null {
	let decoded: string;

	try {
		decoded = Buffer.from(cursor, "base64url").toString("utf8");
	} catch {
		return null;
	}

	if (decoded.length === 0 || decoded.length > 256) return null;

	let parsed: unknown;

	try {
		parsed = JSON.parse(decoded);
	} catch {
		return null;
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}

	const record = parsed as Record<string, unknown>;

	if (
		typeof record.t !== "string" ||
		!CURSOR_TIMESTAMP_PATTERN.test(record.t)
	) {
		return null;
	}

	if (typeof record.i !== "string" || !CURSOR_ID_PATTERN.test(record.i)) {
		return null;
	}

	return { createdAt: record.t, id: record.i };
}

/** Encode one position as the next page cursor. */
export function encodeNotificationCursor(
	createdAt: string,
	id: string,
): string {
	return Buffer.from(JSON.stringify({ t: createdAt, i: id }), "utf8").toString(
		"base64url",
	);
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

/** Reminder types whose copy depends on the milestone's current due date. */
const REMINDER_TYPES = ["milestone_due_soon", "milestone_overdue"] as const;

/**
 * The conditions every read shares.
 *
 * Why this is separate from visibility: these three conditions do not need a
 * join to `comment` or `milestone`, so the unread count can apply them with a
 * single scan of `notification` plus `project`. The rare row classes then add
 * their own EXISTS below.
 */
function notificationBaseScope(tx: TenantTx, tenant: TenantContext) {
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
function commentVisible() {
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
function reminderVisible() {
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
function notificationScope(tx: TenantTx, tenant: TenantContext) {
	return [
		...notificationBaseScope(tx, tenant),
		commentVisible(),
		reminderVisible(),
	];
}

/** Build the select shape once so the list and count read the same joins. */
function notificationSelection() {
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

/**
 * Count unread notifications with the same filters as the list.
 *
 * Why the aggregate is split with FILTER: almost every unread row is an
 * ordinary notification with no comment and no reminder. Counting those with
 * no join to `comment` or `milestone` keeps the hot path on the unread partial
 * index. The two rare classes are guarded by their own column, so their EXISTS
 * is skipped for the rows that cannot be in them. One scan, one number.
 */
async function countUnread(
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
 * Why two statements: read history must match what the person could actually
 * see. A direct UPDATE cannot express the visibility rule, because it depends
 * on the joined project and comment rows, so the visible ids are selected with
 * the exact list predicate first and then updated in chunks. Selecting first
 * also keeps the UPDATE under the bind parameter limit for a large inbox.
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
			const visible = await tx
				.select({ id: notification.id })
				.from(notification)
				.leftJoin(project, eq(notification.projectId, project.id))
				.where(
					and(
						...notificationScope(tx, tenant),
						isNull(notification.readAt),
						// Compare at millisecond precision. The client cutoff is a
						// JavaScript Date, while rows keep microseconds, so a row
						// in the same millisecond must still be included.
						sql`date_trunc('milliseconds', ${notification.createdAt}) <= ${sql.param(before, notification.createdAt)}`,
					),
				);

			let updated = 0;

			for (let index = 0; index < visible.length; index += 500) {
				const chunk = visible.slice(index, index + 500).map((row) => row.id);

				if (chunk.length === 0) continue;

				const rows = await tx
					.update(notification)
					.set({ readAt: new Date() })
					.where(
						and(
							eq(notification.organizationId, tenant.organizationId),
							eq(notification.recipientUserId, tenant.userId),
							isNull(notification.readAt),
							inArray(notification.id, chunk),
						),
					)
					.returning({ id: notification.id });

				updated += rows.length;
			}

			return {
				updated,
				unread: await countUnread(tx, tenant),
			};
		},
	);
}
