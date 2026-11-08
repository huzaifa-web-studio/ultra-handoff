/**
 * Milestone timeline events.
 *
 * Why this module: the event vocabulary is shared by the milestone service that
 * writes the rows, the comment service that reads them, and the web renderer
 * that turns them into a sentence. The pure builders live here too, so the
 * add/remove and estimate rules can be tested without a database.
 *
 * The database check `comment_event_check` in `db/schema.ts` must list the same
 * values. Adding a type here without updating that check is a runtime failure,
 * not a type error.
 *
 * Used by: services/milestone.service.ts and services/comment.service.ts.
 */

/** Every change the milestone timeline can record. */
export const MILESTONE_EVENT_TYPES = [
	"status",
	"start_date",
	"due_date",
	"assignee_added",
	"assignee_removed",
	"estimate_minutes",
] as const;

export type MilestoneEventType = (typeof MILESTONE_EVENT_TYPES)[number];

/** One activity row, before it is written to the comment table. */
export type MilestoneEventDraft = {
	type: MilestoneEventType;
	/** Previous value. Null means the field was empty or the person is new. */
	from: string | null;
	/** New value. Null means the field was cleared or the person was removed. */
	to: string | null;
};

/** The part of an assignee a change needs to describe itself. */
export type AssigneeSnapshot = {
	userId: string;
	name: string;
};

/** True for a value this app writes. Guards rows read back from the database. */
export function isMilestoneEventType(
	value: string | null,
): value is MilestoneEventType {
	return (
		value !== null &&
		(MILESTONE_EVENT_TYPES as readonly string[]).includes(value)
	);
}

/**
 * Sort and join names.
 *
 * Why sorted: two people assigned in a different order are the same set, and
 * the row should read the same way every time. Why joined: one row lists the
 * whole action instead of one row per person.
 */
function joinNames(people: readonly AssigneeSnapshot[]): string {
	return [...people]
		.map((person) => person.name)
		.sort((a, b) => a.localeCompare(b))
		.join(", ");
}

/**
 * Turn an estimate change into a timeline row.
 *
 * Values are stored as minutes in text, matching the date events: the column is
 * text and the client formats it. Null means "no estimate", so clearing a value
 * stays distinguishable from an unchanged one.
 */
export function buildEstimateEvent(
	before: number | null,
	after: number | null,
): MilestoneEventDraft | null {
	if (before === after) return null;

	return {
		type: "estimate_minutes",
		from: before === null ? null : String(before),
		to: after === null ? null : String(after),
	};
}

/**
 * Turn an assignee set change into one row per action.
 *
 * Why additions and removals instead of a before and after list: a set has no
 * natural order, so "changed from A, B to A, C" makes the reader diff two
 * lists. "assigned C" and "unassigned B" says what happened directly. A full
 * set replacement can produce both rows in the same update.
 */
export function buildAssigneeEvents(
	before: readonly AssigneeSnapshot[],
	after: readonly AssigneeSnapshot[],
): MilestoneEventDraft[] {
	const beforeIds = new Set(before.map((person) => person.userId));
	const afterIds = new Set(after.map((person) => person.userId));
	const added = after.filter((person) => !beforeIds.has(person.userId));
	const removed = before.filter((person) => !afterIds.has(person.userId));
	const events: MilestoneEventDraft[] = [];

	if (added.length > 0) {
		events.push({
			type: "assignee_added",
			from: null,
			to: joinNames(added),
		});
	}

	if (removed.length > 0) {
		events.push({
			type: "assignee_removed",
			from: joinNames(removed),
			to: null,
		});
	}

	return events;
}
