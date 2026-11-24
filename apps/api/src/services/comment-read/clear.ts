/**
 * Clear comment notifications for a read thread.
 *
 * Why this file: a read thread should also drop its unread bell rows, and that
 * cleanup is a single recipient-scoped query.
 *
 * Used by: `mark.ts`.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { comment, notification } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { COMMENT_NOTIFICATION_TYPES } from "../../lib/notification-types";
import type { TenantContext } from "../../middleware/tenant";

/** Clear the viewer's comment notifications up to one thread cursor. */
export async function clearCommentNotifications(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	rootId: string,
	cursor: { id: string; createdAt: Date },
): Promise<void> {
	await tx
		.update(notification)
		.set({ readAt: new Date() })
		.from(comment)
		.where(
			and(
				eq(notification.commentId, comment.id),
				eq(notification.organizationId, tenant.organizationId),
				eq(notification.recipientUserId, tenant.userId),
				isNull(notification.readAt),
				inArray(notification.type, [...COMMENT_NOTIFICATION_TYPES]),
				eq(comment.milestoneId, milestoneId),
				sql`coalesce(${comment.parentId}, ${comment.id}) = ${rootId}`,
				/**
				 * Compare against the cursor comment inside Postgres.
				 *
				 * The cursor arrives as a JavaScript Date, which keeps
				 * milliseconds while the stored timestamp keeps microseconds.
				 * Passing the JS value back would place the cutoff a fraction
				 * before the actual comment and leave that comment's
				 * notification unread. The subquery uses the stored value.
				 */
				sql`(${comment.createdAt}, ${comment.id}) <= (
					select cursor_comment.created_at, cursor_comment.id
					from "comment" as cursor_comment
					where cursor_comment.id = ${cursor.id}
				)`,
			),
		);
}
