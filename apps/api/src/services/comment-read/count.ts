/**
 * Unread counts for badges.
 *
 * Why this file: the milestone and project badges need a SQL count without
 * loading every comment. Keeping both counts together means they share the same
 * visibility rule.
 *
 * Used by: `routes/comments.ts` and the notification summary.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { comment, commentThreadRead, milestone } from "../../db/schema";
import { type TenantTx, withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { requireProjectAccess } from "./access";
import { loadUnreadBaseline } from "./baseline";
import type { ProjectUnreadSummary } from "./types";

/**
 * Unread count for one milestone.
 *
 * The read cursor is joined per comment through its thread root. A missing
 * cursor means everything after the baseline is unread. Deleted comments,
 * events and the viewer's own messages never count.
 */
export async function countMilestoneUnread(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	baselineAt: Date,
): Promise<number> {
	const cursorComment = alias(comment, "cursor_comment");

	const [row] = await tx
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(comment)
		.leftJoin(
			commentThreadRead,
			and(
				eq(
					commentThreadRead.rootCommentId,
					sql`coalesce(${comment.parentId}, ${comment.id})`,
				),
				eq(commentThreadRead.userId, tenant.userId),
			),
		)
		.leftJoin(
			cursorComment,
			eq(cursorComment.id, commentThreadRead.lastReadCommentId),
		)
		.where(
			and(
				eq(comment.organizationId, tenant.organizationId),
				eq(comment.milestoneId, milestoneId),
				eq(comment.kind, "comment"),
				isNull(comment.deletedAt),
				sql`${comment.authorId} is distinct from ${tenant.userId}`,
				sql`${comment.createdAt} > ${sql.param(baselineAt, comment.createdAt)}`,
				sql`(
					${commentThreadRead.id} is null
					or (${comment.createdAt}, ${comment.id}) > (${cursorComment.createdAt}, ${cursorComment.id})
				)`,
			),
		);

	return row?.count ?? 0;
}

/**
 * Unread counts grouped by milestone for one project.
 *
 * The route has already checked project access before calling this. One query
 * is enough for every badge in the workspace, so opening a project does not
 * become one count per milestone.
 */
export async function getProjectUnreadSummary(
	tenant: TenantContext,
	projectId: string,
): Promise<ProjectUnreadSummary> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProjectAccess(tx, tenant, projectId);
			const baselineAt = await loadUnreadBaseline(tx, tenant, projectId);
			const cursorComment = alias(comment, "cursor_comment");

			const rows = await tx
				.select({
					milestoneId: comment.milestoneId,
					count: sql<number>`count(*)`.mapWith(Number),
				})
				.from(comment)
				.innerJoin(milestone, eq(comment.milestoneId, milestone.id))
				.leftJoin(
					commentThreadRead,
					and(
						eq(
							commentThreadRead.rootCommentId,
							sql`coalesce(${comment.parentId}, ${comment.id})`,
						),
						eq(commentThreadRead.userId, tenant.userId),
					),
				)
				.leftJoin(
					cursorComment,
					eq(cursorComment.id, commentThreadRead.lastReadCommentId),
				)
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(milestone.projectId, access.projectId),
						eq(comment.kind, "comment"),
						isNull(comment.deletedAt),
						sql`${comment.authorId} is distinct from ${tenant.userId}`,
						sql`${comment.createdAt} > ${sql.param(baselineAt, comment.createdAt)}`,
						sql`(
							${commentThreadRead.id} is null
							or (${comment.createdAt}, ${comment.id}) > (${cursorComment.createdAt}, ${cursorComment.id})
						)`,
					),
				)
				.groupBy(comment.milestoneId);

			const milestones = rows.flatMap((row) =>
				row.milestoneId
					? [{ milestoneId: row.milestoneId, unread: row.count }]
					: [],
			);

			return {
				total: milestones.reduce((sum, item) => sum + item.unread, 0),
				milestones,
			};
		},
	);
}
