/**
 * Notification read state writes.
 *
 * Why this file: mark one and mark all share the same recipient-scoped filter
 * and the same cutoff semantics. Keeping them together makes that boundary
 * explicit.
 *
 * Used by: `routes/notifications.ts`.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { notification, project } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { countUnread } from "./list";
import { notificationScope } from "./scope";
import type { NotificationMarkResult } from "./types";

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
