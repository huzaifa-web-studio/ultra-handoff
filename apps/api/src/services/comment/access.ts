/**
 * Comment access, rate limiting and row loading.
 *
 * Why this file: reading a thread, posting a comment and ticking a checklist
 * item all need the same project access check, the same rate gate and the same
 * cursor helpers. Keeping them here means those rules cannot drift.
 *
 * Used by: the read and write modules in `services/comment/`.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import {
	COMMENT_RATE_LIMIT,
	COMMENT_RATE_WINDOW,
	canModifyComment,
} from "../../auth/comment-permissions";
import { comment } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { consumeRateLimit } from "../../lib/rate-limit";
import type { TenantContext } from "../../middleware/tenant";
import { loadOrganizationMemberUserIds } from "../organization.service";
import { loadUserMap } from "../project";
import type { CommentEventType, CommentRecord, CommentRow } from "./types";

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
export async function allowCommentRate(
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
export function encodeCursor(record: Pick<CommentRecord, "id">): string {
	return Buffer.from(record.id, "utf8").toString("base64url");
}

/** Decode a cursor, rejecting anything that did not come from us. */
export function decodeCursor(cursor: string): string | null {
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
export async function countComments(
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
				eq(comment.kind, "comment"),
				isNull(comment.deletedAt),
			),
		);

	return row?.count ?? 0;
}

/** The scope every single-comment read uses. */
export function commentScope(
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
export async function loadCommentRecord(
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
export async function loadCommentRecordForUpdate(
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
export function toCommentRow(
	record: CommentRecord,
	people: Map<
		string,
		{ name: string; email: string; image: string | null; isMember: boolean }
	>,
	viewerId: string,
	locked: boolean,
): CommentRow {
	const person = record.authorId ? people.get(record.authorId) : undefined;
	const deleted = record.deletedAt !== null;
	const isEvent = record.kind === "event";
	const editable =
		!isEvent &&
		canModifyComment({
			viewerId,
			authorId: record.authorId,
			deletedAt: record.deletedAt,
			locked,
		});
	const event =
		isEvent && record.eventType
			? {
					type: record.eventType as CommentEventType,
					from: record.eventFrom,
					to: record.eventTo,
					note: record.eventNote,
				}
			: null;

	return {
		id: record.id,
		parentId: record.parentId,
		kind: isEvent ? "event" : "comment",
		event,
		body: deleted || isEvent ? [] : record.body,
		author: record.authorId
			? {
					id: record.authorId,
					name: person?.name || person?.email || "Former member",
					image: person?.image ?? null,
					isMember: person?.isMember ?? false,
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

/** Load the display names and membership state for every author in one page. */
export async function loadPeople(
	records: CommentRecord[],
): Promise<
	Map<
		string,
		{ name: string; email: string; image: string | null; isMember: boolean }
	>
> {
	const ids = [
		...new Set(
			records
				.map((record) => record.authorId)
				.filter((id): id is string => Boolean(id)),
		),
	];

	// One page always belongs to one workspace, so the first record names it.
	const organizationId = records[0]?.organizationId;

	const [people, memberIds] = await Promise.all([
		loadUserMap(ids),
		organizationId
			? loadOrganizationMemberUserIds(organizationId, ids)
			: Promise.resolve(new Set<string>()),
	]);

	// Every id gets an entry, even when the user row is gone. That lets the
	// mapper distinguish "former member" from "missing author" without a
	// second lookup.
	return new Map(
		ids.map((id) => {
			const person = people.get(id);

			return [
				id,
				{
					name: person?.name ?? "",
					email: person?.email ?? "",
					image: person?.image ?? null,
					isMember: memberIds.has(id),
				},
			];
		}),
	);
}
