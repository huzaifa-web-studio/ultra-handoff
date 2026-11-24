/**
 * Milestone activity timeline rows.
 *
 * Why this file: create, update, assignee and lock writes all record activity
 * on the same comment timeline, so the vocabulary and the broadcast shape have
 * to be written once. The discussion is the one place a reader already looks
 * for "what changed", which is why events share the comment table instead of a
 * second table with its own cursor.
 *
 * Used by: `create.ts`, `update.ts`, `set-assignees.ts` and `lock.ts`.
 */

import { randomUUID } from "node:crypto";

import { comment } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import {
	isMilestoneEventType,
	type MilestoneEventDraft,
} from "../../lib/milestone-events";
import type { TenantContext } from "../../middleware/tenant";
import { loadUserMap } from "../project.service";
import type { CommentRecord, MilestoneTimelineComment } from "./types";

/**
 * Write activity rows into the comment timeline.
 *
 * Why the comment table instead of a second event table: the discussion is the
 * one place a reader already looks for "what changed". Storing the event as a
 * different `kind` on the same table means one ordered read serves the whole
 * timeline, with no merge step and no second cursor. Events are excluded from
 * the comment count and are never editable, so they cannot be confused with a
 * message.
 *
 * Returns the inserted rows so the caller can broadcast them. `returning` is
 * what gives the broadcast the same ids and timestamps the database stored.
 */
export async function recordMilestoneEvents(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	events: MilestoneEventDraft[],
): Promise<CommentRecord[]> {
	if (events.length === 0) return [];

	return tx
		.insert(comment)
		.values(
			events.map((event) => ({
				id: randomUUID(),
				organizationId: tenant.organizationId,
				milestoneId,
				authorId: tenant.userId,
				kind: "event" as const,
				eventType: event.type,
				eventFrom: event.from,
				eventTo: event.to,
				eventNote: event.note ?? null,
				body: [],
				bodyText: "",
			})),
		)
		.returning();
}

/**
 * Map inserted activity rows into the broadcast shape.
 *
 * A caller's own name is looked up once, not per row, because one update can
 * write two rows (a start date and a due date moved together).
 */
export async function toMilestoneTimeline(
	rows: CommentRecord[],
	tenant: TenantContext,
): Promise<MilestoneTimelineComment[]> {
	if (rows.length === 0) return [];

	const people = await loadUserMap([tenant.userId]);
	const person = people.get(tenant.userId);
	const author = {
		id: tenant.userId,
		name: person?.name || person?.email || "Someone",
		image: person?.image ?? null,
	};

	return rows.flatMap((row) => {
		// A row without an event type is not something this helper wrote, so it
		// cannot be rendered by the timeline. Skipping is safer than guessing.
		if (!isMilestoneEventType(row.eventType)) return [];

		return [
			{
				id: row.id,
				parentId: null,
				kind: "event" as const,
				event: {
					type: row.eventType,
					from: row.eventFrom,
					to: row.eventTo,
					note: row.eventNote,
				},
				body: [],
				author,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
				editedAt: null,
				deletedAt: null,
			},
		];
	});
}
