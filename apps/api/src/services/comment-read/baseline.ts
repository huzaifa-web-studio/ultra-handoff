/**
 * Read cursors and their baseline.
 *
 * Why this file: the effective start of a person's reading is the later of the
 * organization membership and the project membership, and the cursor only ever
 * moves forward. Those two rules live together.
 *
 * Used by: the read and mark modules in `services/comment-read/`.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { commentThreadRead, projectMember } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import type { ThreadReadCursor } from "./types";

/**
 * The effective unread baseline for one person in one project.
 *
 * `memberCreatedAt` comes from the verified tenant context. A project
 * membership row can be later, for example when somebody joins an existing
 * workspace and is then added to a project. The later value wins.
 */
export async function loadUnreadBaseline(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
): Promise<Date> {
	const [row] = await tx
		.select({ createdAt: projectMember.createdAt })
		.from(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, tenant.organizationId),
				eq(projectMember.projectId, projectId),
				eq(projectMember.userId, tenant.userId),
			),
		)
		.limit(1);

	const projectJoinedAt = row?.createdAt ?? null;

	if (projectJoinedAt && projectJoinedAt > tenant.memberCreatedAt) {
		return projectJoinedAt;
	}

	return tenant.memberCreatedAt;
}

/** Load the viewer's cursors for a set of thread roots. */
export async function loadThreadReadCursors(
	tx: TenantTx,
	tenant: TenantContext,
	rootIds: readonly string[],
): Promise<Map<string, ThreadReadCursor>> {
	if (rootIds.length === 0) return new Map();

	const rows = await tx
		.select({
			rootCommentId: commentThreadRead.rootCommentId,
			lastReadAt: commentThreadRead.lastReadAt,
			lastReadCommentId: commentThreadRead.lastReadCommentId,
		})
		.from(commentThreadRead)
		.where(
			and(
				eq(commentThreadRead.organizationId, tenant.organizationId),
				eq(commentThreadRead.userId, tenant.userId),
				inArray(commentThreadRead.rootCommentId, [...rootIds]),
			),
		);

	return new Map(
		rows.map((row) => [
			row.rootCommentId,
			{
				lastReadAt: row.lastReadAt,
				lastReadCommentId: row.lastReadCommentId,
			},
		]),
	);
}

/**
 * The thread root for a comment id.
 *
 * A reply stores its root in `parent_id`. A root stores null. This helper keeps
 * the two cases in one place.
 */
export function threadRootId(
	commentId: string,
	parentId: string | null,
): string {
	return parentId ?? commentId;
}

/**
 * Advance the author's own cursor after they post.
 *
 * Why: a person's own message is never unread to them. Without this, posting a
 * message in a thread they had never opened would leave a divider above their
 * own text. The upsert is monotonic for the same reason every other read write
 * is.
 */
export async function advanceThreadCursor(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		rootCommentId: string;
		commentId: string;
		createdAt: Date;
	},
): Promise<void> {
	await upsertCursor(tx, tenant, input);
}

/** One monotonic cursor upsert. */
export async function upsertCursor(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		rootCommentId: string;
		commentId: string;
		createdAt: Date;
	},
): Promise<void> {
	await tx
		.insert(commentThreadRead)
		.values({
			id: randomUUID(),
			organizationId: tenant.organizationId,
			projectId: input.projectId,
			milestoneId: input.milestoneId,
			rootCommentId: input.rootCommentId,
			userId: tenant.userId,
			lastReadAt: input.createdAt,
			lastReadCommentId: input.commentId,
		})
		.onConflictDoUpdate({
			target: [commentThreadRead.rootCommentId, commentThreadRead.userId],
			set: {
				lastReadAt: sql`excluded.last_read_at`,
				lastReadCommentId: sql`excluded.last_read_comment_id`,
				updatedAt: new Date(),
			},
			setWhere: sql`(${commentThreadRead.lastReadAt}, ${commentThreadRead.lastReadCommentId}) < (excluded.last_read_at, excluded.last_read_comment_id)`,
		});
}
