/**
 * Change request activity events.
 *
 * Why this file: accepting, declining and moving a request all write a timeline
 * row with the same shape, so the event builder lives once.
 *
 * Used by: `update.ts` and `move.ts`.
 */

/** Build one activity row for a change request action. */

import type { MilestoneEventDraft } from "../../lib/milestone-events";
export function buildEvent(
	type: MilestoneEventDraft["type"],
	title: string,
	note?: string | null,
): MilestoneEventDraft {
	return { type, from: null, to: title, note: note ?? null };
}
