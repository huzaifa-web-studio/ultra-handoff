/**
 * Comment business logic.
 *
 * Why one service for a generic table: `comment` is shared by every discussion
 * surface the product will grow (milestones now, deliverables and scope items
 * later), so the rules about who may comment, how deep a reply may go and what
 * a deleted comment looks like live here. The mapping helpers and permission
 * functions are entity neutral. The milestone subject is the only one wired up
 * today, because its access check is the only one that exists. A future surface
 * reuses this file and supplies its own access check instead of copying the
 * thread logic.
 *
 * Shape follows `milestone.service.ts` on purpose:
 *   - every query runs through `withTenant`, so RLS confines it to one
 *     organization
 *   - project and milestone visibility is delegated to `requireMilestoneAccess`
 *   - Better Auth tables are read through `loadUserMap`, never joined inside a
 *     tenant query
 *
 * Threading is two queries, never N+1: one page of root comments newest first,
 * then every reply for those roots in a single read. Paging by root keeps a
 * thread together across page boundaries, which is the only way a reply can
 * never appear without its parent.
 *
 * Used by: src/routes/comments.ts.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
	assertCanComment,
	assertCanModifyComment,
	COMMENT_RATE_LIMIT,
	COMMENT_RATE_WINDOW,
	canModifyComment,
} from "../auth/comment-permissions";
import { assertProjectActive } from "../auth/project-permissions";
import { comment } from "../db/schema";
import { type TenantTx, withTenant } from "../db/tenant";
import { consumeRateLimit } from "../lib/rate-limit";
import { sanitizeCommentBody } from "../lib/rich-text";
import type { TenantContext } from "../middleware/tenant";
import { assertCommentMentions } from "./mention.service";
import { requireMilestoneAccess } from "./milestone.service";
import { loadUserMap } from "./project.service";

/** The person who wrote a comment, as the thread renders it. */
export type CommentAuthor = {
	id: string;
	name: string;
	image: string | null;
};

/** One comment on the wire. */
export type CommentRow = {
	id: string;
	parentId: string | null;
	/** Empty for a deleted comment: the content is gone, the row is not. */
	body: unknown[];
	author: CommentAuthor | null;
	createdAt: string;
	/** Changes on an edit or a checklist toggle, so a static body can refresh. */
	updatedAt: string;
	editedAt: string | null;
	deletedAt: string | null;
	/** True when this caller is the author and the comment is still editable. */
	canEdit: boolean;
	/** Same rule as edit. Kept separate so a future moderator rule is one edit. */
	canDelete: boolean;
};

/** A root comment and its replies, in display order. */
export type CommentThread = {
	comment: CommentRow;
	replies: CommentRow[];
};

/** One page of discussion. */
export type CommentListResult = {
	threads: CommentThread[];
	/** Non-deleted comments in the whole milestone, for the tab badge. */
	total: number;
	/** Opaque cursor for the next older page, or null at the end. */
	nextCursor: string | null;
};

/** One complete thread, used by the focused comment tab. */
export type CommentThreadResult = {
	thread: CommentThread;
};

/** The write result every create and delete returns. */
export type CommentWriteResult = {
	comment: CommentRow;
	total: number;
};

/** The edit result. The count cannot change on an edit. */
export type CommentEditResult = {
	comment: CommentRow;
};

/**
 * Longest a comment post may wait on the throttle.
 *
 * The limiter is a safety net, not a dependency. A Redis outage must not make
 * posting a comment hang, so the check is raced against a short timer that
 * answers "allowed". This mirrors the fail open behaviour of the underlying
 * helper, but bounded in time as well as in outcome.
 */
const RATE_LIMIT_TIMEOUT_MS = 300;

/** Check the post throttle without ever blocking the write for long. */
async function allowCommentRate(
	tenant: TenantContext,
	milestoneId: string,
): Promise<boolean> {
	const check = consumeRateLimit(
		`comment:${tenant.userId}:${milestoneId}`,
		COMMENT_RATE_LIMIT,
		COMMENT_RATE_WINDOW,
	);

	const timeout = new Promise<boolean>((resolve) => {
		setTimeout(() => resolve(true), RATE_LIMIT_TIMEOUT_MS);
	});

	return Promise.race([check, timeout]);
}

/** A database row, before it is mapped to the wire shape. */
type CommentRecord = typeof comment.$inferSelect;

/** Normalised list input, already clamped by the route. */
export type CommentListQuery = {
	cursor: string | null;
	limit: number;
};

/** Public create input. */
export type CreateCommentInput = {
	body: unknown;
	parentId?: string | null;
};

/**
 * Encode a keyset cursor.
 *
 * Why not an offset: a new comment arriving while somebody scrolls back would
 * shift every later page and show the same comment twice. The cursor is the id
 * of the oldest root already shown, and the next page asks Postgres to compare
 * against that row directly. Sending a timestamp instead would round trip a
 * `timestamp` column through a JavaScript Date, which can shift by the host
 * time zone and skip or repeat a page.
 */
function encodeCursor(record: Pick<CommentRecord, "id">): string {
	return Buffer.from(record.id, "utf8").toString("base64url");
}

/** Decode a cursor, rejecting anything that did not come from us. */
function decodeCursor(cursor: string): string | null {
	let decoded: string;

	try {
		decoded = Buffer.from(cursor, "base64url").toString("utf8");
	} catch {
		return null;
	}

	// Ids are short opaque strings in this schema. Anything else is not a cursor
	// we produced, so the page link is rejected instead of silently ignored.
	if (decoded.length === 0 || decoded.length > 64) return null;

	return decoded;
}

/** Count the comments a reader can actually see in one milestone. */
async function countComments(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
): Promise<number> {
	const [row] = await tx
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(comment)
		.where(
			and(
				eq(comment.organizationId, tenant.organizationId),
				eq(comment.milestoneId, milestoneId),
				isNull(comment.deletedAt),
			),
		);

	return row?.count ?? 0;
}

/** The scope every single-comment read uses. */
function commentScope(
	tenant: TenantContext,
	milestoneId: string,
	commentId: string,
) {
	return and(
		eq(comment.organizationId, tenant.organizationId),
		eq(comment.milestoneId, milestoneId),
		eq(comment.id, commentId),
	);
}

/**
 * Load one comment inside one milestone.
 *
 * The milestone id is part of the filter, not only the id, so a crafted request
 * cannot read or edit a comment through a milestone it does not belong to.
 */
async function loadCommentRecord(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	commentId: string,
): Promise<CommentRecord | null> {
	const [record] = await tx
		.select()
		.from(comment)
		.where(commentScope(tenant, milestoneId, commentId))
		.limit(1);

	return record ?? null;
}

/**
 * Load one comment and lock its row for a write.
 *
 * Why: a checklist toggle and a text edit both rewrite `body`. Without a row
 * lock the two could read the same version and the later write would drop the
 * other change. Toggles lock so two readers checking different items both land.
 */
async function loadCommentRecordForUpdate(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	commentId: string,
): Promise<CommentRecord | null> {
	const [record] = await tx
		.select()
		.from(comment)
		.where(commentScope(tenant, milestoneId, commentId))
		.limit(1)
		.for("update");

	return record ?? null;
}

/**
 * Map one database row into the wire shape.
 *
 * A deleted comment never sends its body. The author and timestamps stay, so a
 * thread still reads as a conversation rather than a gap.
 */
function toCommentRow(
	record: CommentRecord,
	people: Map<string, { name: string; email: string; image: string | null }>,
	viewerId: string,
	locked: boolean,
): CommentRow {
	const person = record.authorId ? people.get(record.authorId) : undefined;
	const deleted = record.deletedAt !== null;
	const editable = canModifyComment({
		viewerId,
		authorId: record.authorId,
		deletedAt: record.deletedAt,
		locked,
	});

	return {
		id: record.id,
		parentId: record.parentId,
		body: deleted ? [] : record.body,
		author: record.authorId
			? {
					id: record.authorId,
					name: person?.name || person?.email || "Former member",
					image: person?.image ?? null,
				}
			: null,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
		editedAt: record.editedAt ? record.editedAt.toISOString() : null,
		deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
		canEdit: editable,
		canDelete: editable,
	};
}

/** Load the display names for every author in one page. */
async function loadPeople(
	records: CommentRecord[],
): Promise<Map<string, { name: string; email: string; image: string | null }>> {
	const ids = [
		...new Set(
			records
				.map((record) => record.authorId)
				.filter((id): id is string => Boolean(id)),
		),
	];

	return loadUserMap(ids);
}

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

			const [people, total] = await Promise.all([
				loadPeople([...pageRoots, ...replies]),
				countComments(tx, tenant, milestoneId),
			]);

			const repliesByRoot = new Map<string, CommentRow[]>();

			for (const reply of replies) {
				if (!reply.parentId) continue;

				const list = repliesByRoot.get(reply.parentId) ?? [];
				list.push(toCommentRow(reply, people, tenant.userId, locked));
				repliesByRoot.set(reply.parentId, list);
			}

			// The page is selected newest first for the cursor, but a discussion
			// reads oldest first. Reversing here keeps the newest comment at the
			// bottom of the pane.
			const threads: CommentThread[] = [...pageRoots].reverse().map((root) => ({
				comment: toCommentRow(root, people, tenant.userId, locked),
				replies: repliesByRoot.get(root.id) ?? [],
			}));

			return {
				threads,
				total,
				nextCursor:
					hasMore && pageRoots.length > 0
						? encodeCursor(pageRoots[pageRoots.length - 1] as CommentRecord)
						: null,
			};
		},
	);
}

/**
 * One complete thread, for the focused comment tab.
 *
 * Why a separate read: the list is paged by root, so a comment the reader opened
 * earlier may not be in the pages currently loaded. This endpoint always returns
 * the root and every reply, which is what a dedicated tab needs.
 */
export async function getMilestoneCommentThread(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentId: string,
): Promise<CommentThreadResult> {
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

			const root = await loadCommentRecord(tx, tenant, milestoneId, commentId);

			// A reply has no thread of its own. Answering 404 keeps the tab read
			// honest instead of showing a single reply out of context.
			if (!root || root.parentId !== null) {
				throw new APIError("NOT_FOUND", {
					message: "That discussion no longer exists.",
				});
			}

			const replies = await tx
				.select()
				.from(comment)
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						eq(comment.parentId, commentId),
					),
				)
				.orderBy(asc(comment.createdAt), asc(comment.id));

			const people = await loadPeople([root, ...replies]);

			return {
				thread: {
					comment: toCommentRow(root, people, tenant.userId, locked),
					replies: replies.map((reply) =>
						toCommentRow(reply, people, tenant.userId, locked),
					),
				},
			};
		},
	);
}

/**
 * Post a comment or a reply.
 *
 * The rate limit runs before the transaction so a rejected request never holds
 * a transaction open. It fails open, like every other throttle in the app.
 */
export async function createMilestoneComment(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	input: CreateCommentInput,
): Promise<CommentWriteResult> {
	const body = sanitizeCommentBody(input.body);
	const parentId = input.parentId?.trim() || null;

	const allowed = await allowCommentRate(tenant, milestoneId);

	if (!allowed) {
		throw new APIError("TOO_MANY_REQUESTS", {
			message: "You are posting too quickly. Wait a minute and try again.",
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

			assertProjectActive(access.row.archivedAt);
			assertCanComment(tenant.role, access.role);

			if (parentId) {
				const parent = await loadCommentRecord(
					tx,
					tenant,
					milestoneId,
					parentId,
				);

				if (!parent) {
					throw new APIError("NOT_FOUND", {
						message: "The comment you replied to no longer exists.",
					});
				}

				if (parent.deletedAt !== null) {
					throw new APIError("BAD_REQUEST", {
						message: "You cannot reply to a deleted comment.",
					});
				}

				if (parent.parentId !== null) {
					throw new APIError("BAD_REQUEST", {
						message:
							"Replies are one level deep. Reply to the first comment instead.",
					});
				}
			}

			const commentId = randomUUID();

			// Mentions are checked inside the same transaction as the insert, so
			// a project, milestone or person cannot be removed between the check
			// and the stored body.
			await assertCommentMentions(tx, tenant, projectId, body.value);

			await tx.insert(comment).values({
				id: commentId,
				organizationId: tenant.organizationId,
				milestoneId,
				parentId,
				authorId: tenant.userId,
				body: body.value,
				bodyText: body.text,
			});

			const record = await loadCommentRecord(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That comment could not be read back.",
				});
			}

			const people = await loadUserMap([tenant.userId]);

			return {
				comment: toCommentRow(record, people, tenant.userId, false),
				total: await countComments(tx, tenant, milestoneId),
			};
		},
	);
}

/** Change the body of your own comment. */
export async function updateMilestoneComment(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentId: string,
	input: { body: unknown },
): Promise<CommentEditResult> {
	const body = sanitizeCommentBody(input.body);

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			assertProjectActive(access.row.archivedAt);

			const record = await loadCommentRecordForUpdate(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			assertCanModifyComment({
				viewerId: tenant.userId,
				authorId: record.authorId,
				deletedAt: record.deletedAt,
				locked: access.row.archivedAt !== null,
			});

			// An edit can add or remove mentions, so the same guard runs again.
			await assertCommentMentions(tx, tenant, projectId, body.value);

			await tx
				.update(comment)
				.set({
					body: body.value,
					bodyText: body.text,
					editedAt: new Date(),
				})
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						eq(comment.id, commentId),
					),
				);

			const updated = await loadCommentRecord(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!updated) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			const people = await loadPeople([updated]);

			return {
				comment: toCommentRow(updated, people, tenant.userId, false),
			};
		},
	);
}

/** The toggled comment, ready for the list and thread caches. */
export type CommentChecklistResult = {
	comment: CommentRow;
};

/** One checklist item change. */
export type ToggleChecklistInput = {
	itemId: string;
	checked: boolean;
};

/** One checklist item inside a sanitized body. */
type ChecklistItem = Record<string, unknown> & {
	id: string;
	checked: boolean;
};

/** Find a checklist item by id, walking nested lists. */
function findChecklistItem(
	nodes: unknown[],
	itemId: string,
): ChecklistItem | null {
	for (const node of nodes) {
		if (!node || typeof node !== "object") continue;

		const record = node as Record<string, unknown>;

		if (record.id === itemId && typeof record.checked === "boolean") {
			return record as ChecklistItem;
		}

		if (Array.isArray(record.children)) {
			const found = findChecklistItem(record.children, itemId);

			if (found) return found;
		}
	}

	return null;
}

/**
 * Flip one checklist item.
 *
 * Anyone who can comment may do this, including a client. The comment text is
 * untouched, the author's edited marker does not move, and the row lock keeps
 * two readers checking different items from dropping each other's change.
 */
export async function toggleMilestoneChecklistItem(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentId: string,
	input: ToggleChecklistInput,
): Promise<CommentChecklistResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			assertProjectActive(access.row.archivedAt);
			assertCanComment(tenant.role, access.role);

			const record = await loadCommentRecordForUpdate(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			if (record.deletedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "That comment was deleted and can no longer be changed.",
				});
			}

			const body = structuredClone(record.body);
			const item = findChecklistItem(body, input.itemId);

			if (!item) {
				throw new APIError("NOT_FOUND", {
					message: "That checklist item no longer exists.",
				});
			}

			// A tap that matches the stored state is a no-op. Returning the row
			// without an update keeps `updatedAt` and the static body stable.
			if (item.checked === input.checked) {
				const people = await loadPeople([record]);

				return {
					comment: toCommentRow(record, people, tenant.userId, false),
				};
			}

			item.checked = input.checked;

			const [updated] = await tx
				.update(comment)
				.set({ body })
				.where(commentScope(tenant, milestoneId, commentId))
				.returning();

			if (!updated) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			const people = await loadPeople([updated]);

			return {
				comment: toCommentRow(updated, people, tenant.userId, false),
			};
		},
	);
}

/**
 * Delete your own comment.
 *
 * Soft delete: the row stays so replies keep their thread and the record of who
 * spoke remains, while the body and its mirror are blanked so the content is
 * actually gone. Repeating the call is not allowed because the second one would
 * look like a successful edit of deleted content; the service answers 400 with
 * the same wording the UI shows.
 */
export async function deleteMilestoneComment(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	commentId: string,
): Promise<CommentWriteResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			assertProjectActive(access.row.archivedAt);

			const record = await loadCommentRecordForUpdate(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			assertCanModifyComment({
				viewerId: tenant.userId,
				authorId: record.authorId,
				deletedAt: record.deletedAt,
				locked: access.row.archivedAt !== null,
			});

			await tx
				.update(comment)
				.set({
					deletedAt: new Date(),
					body: [],
					bodyText: "",
				})
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						eq(comment.id, commentId),
					),
				);

			const deleted = await loadCommentRecord(
				tx,
				tenant,
				milestoneId,
				commentId,
			);

			if (!deleted) {
				throw new APIError("NOT_FOUND", {
					message: "That comment no longer exists.",
				});
			}

			const people = await loadPeople([deleted]);

			return {
				comment: toCommentRow(deleted, people, tenant.userId, false),
				total: await countComments(tx, tenant, milestoneId),
			};
		},
	);
}
