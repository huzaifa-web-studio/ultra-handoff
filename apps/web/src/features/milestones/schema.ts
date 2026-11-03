/**
 * Milestone vocabulary and formatting helpers for the web app.
 *
 * Why a mirror of the API constants: the form has to state limits before a
 * request is made, and the badges need labels. The API stays authoritative and
 * rejects anything invalid, so this file is copy and input affordance only.
 *
 * Used by: every component in features/milestones.
 */

import { formatDate } from "#/lib/date";

/** The five states a milestone can be in. Mirrors the API allowlist. */
export const MILESTONE_STATUSES = [
	"todo",
	"in_progress",
	"blocked",
	"done",
	"cancelled",
] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
	todo: "To do",
	in_progress: "In progress",
	blocked: "Blocked",
	done: "Done",
	cancelled: "Cancelled",
};

/** Statuses that count as live work. */
export const ACTIVE_MILESTONE_STATUSES: readonly MilestoneStatus[] = [
	"todo",
	"in_progress",
	"blocked",
];

/** The filter value used by the list toolbar. */
export type MilestoneStatusFilter = "all" | "active" | MilestoneStatus;

export type MilestoneSort = "dueDate" | "createdAt" | "title";

/** Longest accepted title. Mirrors the API. */
export const MILESTONE_TITLE_MAX = 160;

/** Longest single estimate, in minutes (about 41 days). */
export const MILESTONE_ESTIMATE_MAX = 60_000;

/** Longest search text the API accepts. */
export const MILESTONE_SEARCH_MAX = 100;

/**
 * How far before today a milestone date may be scheduled, in years.
 *
 * Why a limit at all: the calendar year dropdown otherwise offers an
 * effectively unlimited range, which is noise for a project milestone. Ten
 * years back covers late data entry and long running engagements without
 * letting a typo land in 1998.
 */
export const MILESTONE_DATE_YEARS_BACK = 10;

/** How far after today a milestone date may be scheduled, in years. */
export const MILESTONE_DATE_YEARS_FORWARD = 10;

/** Rows per list page. */
export const MILESTONE_PAGE_SIZE = 25;

/** Everything the list request accepts. */
export type MilestoneFilters = {
	search: string;
	status: MilestoneStatusFilter;
	sort: MilestoneSort;
	direction: "asc" | "desc";
	pageSize: number;
};

/** True when a value is one of the five statuses. */
export function isMilestoneStatus(value: string): value is MilestoneStatus {
	return (MILESTONE_STATUSES as readonly string[]).includes(value);
}

/** Label for a status, falling back to the raw value. */
export function milestoneStatusLabel(status: string): string {
	return isMilestoneStatus(status) ? MILESTONE_STATUS_LABELS[status] : status;
}

/** The local calendar day as `YYYY-MM-DD`. */
export function localIsoDay(date: Date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	return `${year}-${month}-${day}`;
}

/** Whole days from `from` to `to`. Both are `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
	const start = Date.parse(`${from}T00:00:00Z`);
	const end = Date.parse(`${to}T00:00:00Z`);

	if (Number.isNaN(start) || Number.isNaN(end)) return 0;

	return Math.round((end - start) / 86_400_000);
}

/**
 * Normalise a stored date into a `YYYY-MM-DD` day.
 *
 * Why this exists: the API returns day-only strings, but the value that reaches
 * a formatter can also be a full ISO timestamp (a cached response written by an
 * older shape, a fixture, or any future column that stores an instant). The
 * helpers below build a date by appending `T00:00:00`, so an input that already
 * carries a time produced an unparseable string and threw
 * `RangeError: Invalid time value`, which took down the whole route.
 *
 * Accepts `YYYY-MM-DD`, `YYYY-MM-DDThh:mm:ss(.sss)(Z|offset)` and
 * `YYYY-MM-DD hh:mm:ss`. Anything else, including an impossible day such as
 * 2026-02-31, returns null so the caller can show "No date" instead of a crash.
 */
export function normalizeDay(value: unknown): string | null {
	const text = dayText(value);
	if (text === null) return null;

	const trimmed = text.trim();
	if (trimmed.length === 0) return null;

	const day = trimmed.slice(0, 10);

	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

	// A longer string must be a day followed by a time separator, otherwise it
	// is some other format and should not be read as a date.
	const separator = trimmed[10];
	if (trimmed.length > 10 && separator !== "T" && separator !== " ") {
		return null;
	}

	// The round trip proves the day exists, so 2026-02-31 is rejected instead
	// of silently rolling over to March.
	const parsed = new Date(`${day}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return null;
	if (parsed.toISOString().slice(0, 10) !== day) return null;

	return day;
}

/**
 * Read any date shaped value as text.
 *
 * Why this is not just `typeof value === "string"`: a controlled date field
 * can be handed a `CalendarDate` (React Aria's date type) or a native `Date`
 * by a caller, and a cached response may carry the serialized form of either.
 * All of them represent a real day, so rejecting them turned a valid date into
 * "No dates" in the UI. Reading the fields directly is safer than trusting
 * `toString`, whose output is not part of the contract.
 */
function dayText(value: unknown): string | null {
	if (value == null) return null;

	if (typeof value === "string") return value;

	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : localIsoDay(value);
	}

	if (typeof value === "object") {
		const candidate = value as {
			year?: unknown;
			month?: unknown;
			day?: unknown;
		};

		if (
			typeof candidate.year === "number" &&
			typeof candidate.month === "number" &&
			typeof candidate.day === "number"
		) {
			return `${candidate.year}-${String(candidate.month).padStart(2, "0")}-${String(candidate.day).padStart(2, "0")}`;
		}
	}

	return null;
}

/**
 * True when a milestone is late.
 *
 * Done and cancelled work is never overdue, even when the due date has passed:
 * the date stopped mattering when the milestone was closed.
 */
export function isMilestoneOverdue(
	dueDate: string | null,
	status: MilestoneStatus,
	today: string = localIsoDay(),
): boolean {
	const day = normalizeDay(dueDate);
	const reference = normalizeDay(today);

	if (!day || !reference) return false;
	if (status === "done" || status === "cancelled") return false;

	return day < reference;
}

/**
 * Human readable due date copy.
 *
 * Kept short because it sits in a dense list row: "Due today", "Overdue by 3
 * days", or the formatted date for anything further out.
 */
export function describeDueDate(
	dueDate: string | null,
	status: MilestoneStatus,
	today: string = localIsoDay(),
): string {
	const day = normalizeDay(dueDate);
	if (!day) return "No due date";

	const reference = normalizeDay(today) ?? localIsoDay();
	const diff = daysBetween(reference, day);

	if (status !== "done" && status !== "cancelled") {
		if (diff === 0) return "Due today";
		if (diff === 1) return "Due tomorrow";
		if (diff === -1) return "Overdue by 1 day";
		if (diff < -1) return `Overdue by ${Math.abs(diff)} days`;
	}

	return formatDate(`${day}T00:00:00`);
}

/**
 * Format a start and due pair for the date field trigger.
 *
 * A one sided schedule is named so the trigger does not read as a broken
 * range, for example "Start 3 Nov" instead of "3 Nov - No due date".
 */
export function describeDateRange(
	startDate: string | null,
	dueDate: string | null,
): string {
	const startDay = normalizeDay(startDate);
	const dueDay = normalizeDay(dueDate);

	if (!startDay && !dueDay) return "No dates";

	const start = startDay ? formatDate(`${startDay}T00:00:00`) : null;
	const due = dueDay ? formatDate(`${dueDay}T00:00:00`) : null;

	if (start && due) return `${start} - ${due}`;
	if (start) return `Start ${start}`;

	return `Due ${due}`;
}

/**
 * Format minutes as `1h 30m`.
 *
 * Used in the list meta row and as the estimate field helper, so the value the
 * user typed and the value they see afterwards are written the same way.
 */
export function formatEstimate(minutes: number | null): string {
	if (minutes == null || minutes <= 0) return "No estimate";

	const days = Math.floor(minutes / 1_440);
	const hours = Math.floor((minutes % 1_440) / 60);
	const rest = minutes % 60;
	const parts: string[] = [];

	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (rest > 0) parts.push(`${rest}m`);

	return parts.length > 0 ? parts.join(" ") : "0m";
}

/** Seconds per accepted unit, used by the estimate parser. */
const ESTIMATE_UNIT_SECONDS: Record<string, number> = {
	s: 1,
	sec: 1,
	secs: 1,
	second: 1,
	seconds: 1,
	m: 60,
	min: 60,
	mins: 60,
	minute: 60,
	minutes: 60,
	h: 3_600,
	hr: 3_600,
	hrs: 3_600,
	hour: 3_600,
	hours: 3_600,
	d: 86_400,
	day: 86_400,
	days: 86_400,
};

/** Result of parsing the estimate input. */
export type EstimateParseResult =
	| { ok: true; minutes: number | null }
	| { ok: false; message: string };

/**
 * Parse what a person types into a whole number of minutes.
 *
 * Accepted: `90`, `90m`, `1.5h`, `1h 30m`, `1:30`. Empty means "no estimate".
 * Everything else is rejected with a message that says what is accepted,
 * because a silent correction would store a number the user never meant.
 */
export function parseEstimateInput(raw: string): EstimateParseResult {
	const value = raw.trim().toLowerCase();

	if (value.length === 0) return { ok: true, minutes: null };

	const invalid: EstimateParseResult = {
		ok: false,
		message: "Use minutes (90) or a duration such as 1h 30m or 1d 2h.",
	};

	// Clock form: 1:30 is one hour and thirty minutes.
	const clock = value.match(/^(\d+):([0-5]\d)$/);
	if (clock) {
		return fromSeconds(Number(clock[1]) * 3_600 + Number(clock[2]) * 60);
	}

	// A lone number is minutes, which is the unit that is stored.
	if (/^\d+$/.test(value)) {
		return fromSeconds(Number(value) * 60);
	}

	// Everything else must be one or more number and unit pairs, in any order,
	// so "1d 2h 30m", "2h30m" and "30m 1d" all read the same way.
	const pattern =
		/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)/g;

	let totalSeconds = 0;
	let consumed = 0;
	let tokens = 0;
	let match = pattern.exec(value);

	while (match !== null) {
		// Anything between two matches other than whitespace means the string is
		// not purely a duration, for example "1h soon".
		if (value.slice(consumed, match.index).trim().length > 0) return invalid;

		const unitSeconds = ESTIMATE_UNIT_SECONDS[match[2]];

		if (unitSeconds === undefined) return invalid;

		totalSeconds += Number(match[1]) * unitSeconds;
		consumed = match.index + match[0].length;
		tokens += 1;
		match = pattern.exec(value);
	}

	if (tokens === 0) return invalid;
	if (value.slice(consumed).trim().length > 0) return invalid;

	return fromSeconds(totalSeconds);

	/** Convert the parsed duration into the whole minutes the API stores. */
	function fromSeconds(seconds: number): EstimateParseResult {
		if (!Number.isFinite(seconds) || seconds <= 0) {
			return { ok: false, message: "The estimate must be at least 1 minute." };
		}

		// Seconds are accepted because people think in them, but the column
		// stores whole minutes. Round to the nearest minute, and anything above
		// zero still counts as at least one minute.
		const minutes = Math.max(1, Math.round(seconds / 60));

		if (minutes > MILESTONE_ESTIMATE_MAX) {
			return {
				ok: false,
				message: `The estimate cannot be more than ${formatEstimate(MILESTONE_ESTIMATE_MAX)}.`,
			};
		}

		return { ok: true, minutes };
	}
}

/** The value shown inside the estimate input, without the "No estimate" copy. */
export function estimateInputValue(minutes: number | null): string {
	return minutes == null ? "" : formatEstimate(minutes);
}
