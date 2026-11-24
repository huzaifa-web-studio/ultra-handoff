/**
 * Notification summary.
 *
 * Why this file: the summary groups unread rows by project and is a separate
 * read from the paged list, with its own small payload.
 *
 * Used by: `routes/notifications.ts`.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { notification, project } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { countUnread } from "./list";
import { notificationScope } from "./scope";
import type { NotificationSummary } from "./types";

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
