/**
 * Timezone and calendar day helpers.
 *
 * Why this exists: a milestone has a due date, not a due instant. "Due today"
 * therefore means different things to two people in different zones, and a
 * reminder sweep must evaluate each recipient on their own local calendar day.
 * `Intl` already knows the IANA database and every DST rule, so the code never
 * computes offsets by hand.
 *
 * Used by: src/lib/notifications.ts (copy), services/reminder.service.ts
 * (sweep) and src/auth/auth.ts (validating the reported zone).
 */

/** Longest IANA name this product accepts. */
const TIMEZONE_MAX = 64;

/**
 * Validate an IANA timezone name.
 *
 * A length and character check first, then the real test: constructing a
 * formatter throws for an unknown zone. Returns the trimmed value or null.
 */
export function normalizeTimezone(value: unknown): string | null {
	if (typeof value !== "string") return null;

	const trimmed = value.trim();

	if (trimmed.length === 0 || trimmed.length > TIMEZONE_MAX) return null;
	if (!/^[A-Za-z0-9_+\-/]+$/.test(trimmed)) return null;

	try {
		new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
	} catch {
		return null;
	}

	return trimmed;
}

/** The zone to use when a person has not reported one. */
export const FALLBACK_TIMEZONE = "UTC";

/** The local calendar day and hour for one instant in one zone. */
export type LocalClock = {
	/** `YYYY-MM-DD` in the zone. */
	day: string;
	/** 0 to 23, local to the zone. */
	hour: number;
};

/**
 * Read the local day and hour.
 *
 * `en-CA` with numeric parts produces the `YYYY-MM-DD` order directly. The
 * zone is validated by the caller, but an invalid value falls back to UTC
 * instead of throwing inside a background sweep.
 */
export function localClock(now: Date, timeZone: string): LocalClock {
	const zone = normalizeTimezone(timeZone) ?? FALLBACK_TIMEZONE;

	try {
		const parts = new Intl.DateTimeFormat("en-CA", {
			timeZone: zone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			hourCycle: "h23",
		}).formatToParts(now);

		const year = parts.find((part) => part.type === "year")?.value;
		const month = parts.find((part) => part.type === "month")?.value;
		const day = parts.find((part) => part.type === "day")?.value;
		const hour = parts.find((part) => part.type === "hour")?.value;

		if (!year || !month || !day || !hour) {
			return fallbackClock(now);
		}

		return {
			day: `${year}-${month}-${day}`,
			hour: Number.parseInt(hour, 10),
		};
	} catch {
		return fallbackClock(now);
	}
}

/** Last resort if a formatter fails for an unexpected runtime reason. */
function fallbackClock(now: Date): LocalClock {
	const day = now.toISOString().slice(0, 10);

	return { day, hour: now.getUTCHours() };
}

/**
 * Whole days from `from` to `to`, both `YYYY-MM-DD`.
 *
 * Calendar days are converted to UTC noon before subtracting, so a DST change
 * between the two dates cannot produce a 23 or 25 hour day and round wrong.
 */
export function dayDifference(from: string, to: string): number {
	const start = Date.parse(`${from}T12:00:00Z`);
	const end = Date.parse(`${to}T12:00:00Z`);

	if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;

	return Math.round((end - start) / 86_400_000);
}

/**
 * Format a calendar day as day month year, for example `3 Nov 2026`.
 *
 * Rule 24 applies to every date a person sees, including server rendered
 * notification copy. Formatting at UTC noon keeps the day from shifting for a
 * reader west of UTC.
 */
export function formatCalendarDay(day: string): string {
	const parsed = Date.parse(`${day}T12:00:00Z`);

	if (!Number.isFinite(parsed)) return day;

	return new Intl.DateTimeFormat("en-GB", {
		dateStyle: "medium",
		timeZone: "UTC",
	}).format(new Date(parsed));
}
