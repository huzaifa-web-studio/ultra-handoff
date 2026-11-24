/**
 * Comment thread listing.
 *
 * Why this file: the list is the only place that pages roots and then loads
 * their replies in one read. Keeping the two queries together is what stops a
 * reply from appearing without its parent across a page boundary.
 *
 * Used by: `routes/comments.ts`.
 */

import { APIError } from "better-auth/api";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { comment } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import {
	computeThreadUnread,
	countMilestoneUnread,
	loadThreadReadCursors,
	loadUnreadBaseline,
} from "../comment-read.service";
import { requireMilestoneAccess } from "../milestone";
import {
	countComments,
	decodeCursor,
	encodeCursor,
	loadPeople,
	toCommentRow,
} from "./access";
import type {
	CommentListQuery,
	CommentListResult,
	CommentRecord,
	CommentThread,
} from "./types";

/**
 * One page of the discussion.
 *
 * Deleted roots stay in the page so their replies remain reachable; deleted
 * replies stay so the conversation keeps its shape.
 */
export async function listMilestoneComments(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	query: CommentListQuery,
): Promise<CommentListResult> {
	const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

	if (query.cursor && !cursorId) {
		throw new APIError("BAD_REQUEST", {
			message: "That comments page link is no longer valid.",
		});
	}

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);
			const locked = access.row.archivedAt !== null;

			// Resolve the cursor row inside Postgres so the comparison uses the
			// stored timestamp, not a JavaScript Date that may have shifted.
			const cursorClause = cursorId
				? sql`(${comment.createdAt}, ${comment.id}) < (
						select cursor_comment.created_at, cursor_comment.id
						from ${comment} as cursor_comment
						where cursor_comment.id = ${cursorId}
							and cursor_comment.organization_id = ${tenant.organizationId}
							and cursor_comment.milestone_id = ${milestoneId}
							and cursor_comment.parent_id is null
					)`
				: undefined;

			// One extra row answers "is there another page" without a second count.
			const rows = await tx
				.select()
				.from(comment)
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						isNull(comment.parentId),
						...(cursorClause ? [cursorClause] : []),
					),
				)
				.orderBy(desc(comment.createdAt), desc(comment.id))
				.limit(query.limit + 1);

			const hasMore = rows.length > query.limit;
			const pageRoots = hasMore ? rows.slice(0, query.limit) : rows;
			const rootIds = pageRoots.map((record) => record.id);

			const replies =
				rootIds.length > 0
					? await tx
							.select()
							.from(comment)
							.where(
								and(
									eq(comment.organizationId, tenant.organizationId),
									eq(comment.milestoneId, milestoneId),
									inArray(comment.parentId, rootIds),
								),
							)
							.orderBy(asc(comment.createdAt), asc(comment.id))
					: [];

			const [people, total, baselineAt, cursors] = await Promise.all([
				loadPeople([...pageRoots, ...replies]),
				countComments(tx, tenant, milestoneId),
				loadUnreadBaseline(tx, tenant, projectId),
				loadThreadReadCursors(tx, tenant, rootIds),
			]);

			const recordsByRoot = new Map<string, CommentRecord[]>();

			for (const reply of replies) {
				if (!reply.parentId) continue;

				const list = recordsByRoot.get(reply.parentId) ?? [];
				list.push(reply);
				recordsByRoot.set(reply.parentId, list);
			}

			// The page is selected newest first for the cursor, but a discussion
			// reads oldest first. Reversing here keeps the newest comment at the
			// bottom of the pane.
			const threads: CommentThread[] = [...pageRoots].reverse().map((root) => {
				const threadReplies = recordsByRoot.get(root.id) ?? [];
				const orderedRecords = [root, ...threadReplies];
				const cursor = cursors.get(root.id);

				return {
					comment: toCommentRow(root, people, tenant.userId, locked),
					replies: threadReplies.map((reply) =>
						toCommentRow(reply, people, tenant.userId, locked),
					),
					unread: computeThreadUnread({
						comments: orderedRecords.map((record) => ({
							id: record.id,
							authorId: record.authorId,
							kind: record.kind,
							createdAt: record.createdAt,
							deletedAt: record.deletedAt,
						})),
						viewerId: tenant.userId,
						baselineAt,
						cursorId: cursor?.lastReadCommentId ?? null,
					}),
				};
			});

			return {
				threads,
				total,
				unreadTotal: await countMilestoneUnread(
					tx,
					tenant,
					milestoneId,
					baselineAt,
				),
				nextCursor:
					hasMore && pageRoots.length > 0
						? encodeCursor(pageRoots[pageRoots.length - 1] as CommentRecord)
						: null,
			};
		},
	);
}
