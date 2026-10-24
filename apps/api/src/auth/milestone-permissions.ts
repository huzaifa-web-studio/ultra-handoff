/**
 * Milestone vocabulary, permissions and input validation.
 *
 * Why a separate module: the service, the routes and the mirrored web schema
 * all need the same limits and the same status names. One module stops the
 * three copies from drifting apart, exactly like `project-permissions.ts` does
 * for projects.
 *
 * The browser copy in `apps/web/src/features/milestones/schema.ts` is cosmetic.
 * Every write is validated here, on the server, before it reaches Postgres.
 *
 * Used by: src/services/milestone.service.ts and src/routes/milestones.ts.
 */

import { APIError } from "better-auth/api";
import { effectiveProjectRole } from "./project-permissions";

/** The five states a milestone can be in. */
export const MILESTONE_STATUSES = [
	"todo",
	"in_progress",
	"blocked",
	"done",
	"cancelled",
] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** Labels for the list, the filter chips and toasts. */
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
	todo: "To do",
	in_progress: "In progress",
	blocked: "Blocked",
	done: "Done",
	cancelled: "Cancelled",
};

/**
 * Statuses that count as live work.
 *
 * This is the default list filter: finished and abandoned milestones stay out
 * of the way until the user asks for them.
 */
export const ACTIVE_MILESTONE_STATUSES: readonly MilestoneStatus[] = [
	"todo",
	"in_progress",
	"blocked",
];

/** Longest accepted title. Matches the web form limit. */
export const MILESTONE_TITLE_MAX = 160;

/**
 * Largest accepted editor payload, measured as serialized JSON characters.
 *
 * Why a cap at all: the body arrives from the browser, and an unbounded JSON
 * column is both a storage and a rendering hazard. 200k characters is far more
 * than a milestone description ever needs.
 */
export const MILESTONE_DESCRIPTION_MAX = 200_000;

/** Largest plain text mirror kept for search and previews. */
export const MILESTONE_TEXT_MAX = 5_000;

/** Longest single estimate, in minutes (about 41 days). */
export const MILESTONE_ESTIMATE_MAX = 60_000;

/** Most people one milestone can be assigned to in one request. */
export const MILESTONE_ASSIGNEE_MAX = 25;

/** True when a value is one of the five statuses. */
export function isMilestoneStatus(value: string): value is MilestoneStatus {
	return (MILESTONE_STATUSES as readonly string[]).includes(value);
}

/**
 * Reject any status outside the allowlist.
 *
 * The database has the same check. This version exists so the client receives
 * a readable message instead of a constraint violation.
 */
export function validateMilestoneStatus(value: string): MilestoneStatus {
	if (!isMilestoneStatus(value)) {
		throw new APIError("BAD_REQUEST", {
			message: `Unknown milestone status: ${value}.`,
		});
	}

	return value;
}

/**
 * Validate and trim a title.
 *
 * Trim first because a surrounding space is invisible and never intended.
 * The upper bound matches the list layout, where two lines of title fit.
 */
export function validateMilestoneTitle(title: string): string {
	const value = title.trim();

	if (value.length < 1 || value.length > MILESTONE_TITLE_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: `The milestone title must be between 1 and ${MILESTONE_TITLE_MAX} characters.`,
		});
	}

	return value;
}

/**
 * Validate a calendar day in `YYYY-MM-DD` form.
 *
 * Why not `new Date(value)`: that accepts "2026-02-31" and silently rolls it
 * over to March. The round trip below proves the day exists. An empty string
 * is treated as "clear the date", which is how the client expresses a cleared
 * field through PATCH.
 */
export function validateMilestoneDate(
	value: string | null | undefined,
	label: string,
): string | null {
	if (value == null) return null;

	const trimmed = value.trim();

	if (trimmed.length === 0) return null;

	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		throw new APIError("BAD_REQUEST", {
			message: `${label} must be a calendar day such as 2026-10-24.`,
		});
	}

	const parsed = new Date(`${trimmed}T00:00:00Z`);

	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== trimmed
	) {
		throw new APIError("BAD_REQUEST", {
			message: `${label} is not a real day.`,
		});
	}

	return trimmed;
}

/** Reject a range whose start is after its end. Both sides are optional. */
export function validateMilestoneDateRange(
	startDate: string | null,
	dueDate: string | null,
): void {
	// ISO days compare correctly as strings, which avoids another Date round
	// trip and cannot be affected by the server timezone.
	if (startDate && dueDate && startDate > dueDate) {
		throw new APIError("BAD_REQUEST", {
			message: "The start date cannot be after the due date.",
		});
	}
}

/**
 * Validate a time estimate in minutes.
 *
 * Null and an empty string both mean "no estimate". Zero is rejected because
 * "no estimate" already has a representation, and a zero minute estimate is
 * never what somebody means.
 */
export function validateMilestoneEstimate(
	value: number | string | null | undefined,
): number | null {
	if (value == null) return null;

	if (typeof value === "string" && value.trim().length === 0) return null;

	const minutes = typeof value === "number" ? value : Number(value);

	if (
		!Number.isInteger(minutes) ||
		minutes < 1 ||
		minutes > MILESTONE_ESTIMATE_MAX
	) {
		throw new APIError("BAD_REQUEST", {
			message: `The estimate must be a whole number of minutes between 1 and ${MILESTONE_ESTIMATE_MAX}.`,
		});
	}

	return minutes;
}

/**
 * True when the caller may create, edit or delete milestones.
 *
 * Owners, admins and plain members write. The `client` role reads only, which
 * keeps the client side of the product about reviewing and approving rather
 * than authoring the plan. Archived projects are handled separately by
 * `assertProjectActive`, so this stays a pure role question.
 */
export function canWriteMilestones(
	organizationRole: string,
	projectRole: string | null | undefined,
): boolean {
	const role = effectiveProjectRole(organizationRole, projectRole);

	return role === "owner" || role === "admin" || role === "member";
}
