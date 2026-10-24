/**
 * Date formatting shared by the members and invitations pages.
 *
 * Why one module: "Joined", "Sent" and "Expires" all need the same locale
 * aware output, and every one of them shows a full timestamp on hover. Keeping
 * the format rules here means a change applies everywhere at once.
 *
 * Used by: features/members and features/invitations.
 */

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
});

/** Shown instead of a formatted value when a stored date cannot be parsed. */
const UNKNOWN_DATE = "Unknown date";

/**
 * Build a valid Date, or null.
 *
 * Why: a formatting helper should never be able to crash a page. A malformed
 * value (an empty string, a timestamp fragment, a value from an older API
 * shape) used to throw `RangeError: Invalid time value` from
 * `Intl.DateTimeFormat.format`, which unmounted the whole route.
 */
function toValidDate(value: string | Date): Date | null {
	const date = value instanceof Date ? value : new Date(value);

	return Number.isNaN(date.getTime()) ? null : date;
}

/** Local date, for example "21 Oct 2026". */
export function formatDate(value: string | Date): string {
	const date = toValidDate(value);

	return date ? DATE_FORMAT.format(date) : UNKNOWN_DATE;
}

/** Full local date and time, used as the title of a relative label. */
export function formatDateTime(value: string | Date): string {
	const date = toValidDate(value);

	if (!date) return UNKNOWN_DATE;

	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

/**
 * Short relative label, for example "in 3 days" or "2 hours ago".
 *
 * Days are the smallest unit after an hour, which is enough for invitations
 * that live for a week. Values close to zero read as "now".
 */
export function formatRelativeTime(
	value: string | Date,
	now: Date = new Date(),
): string {
	const date = toValidDate(value);

	if (!date) return UNKNOWN_DATE;

	const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
	const abs = Math.abs(diffSeconds);

	if (abs < 60) return RELATIVE_FORMAT.format(0, "second");
	if (abs < 60 * 60) {
		return RELATIVE_FORMAT.format(Math.round(diffSeconds / 60), "minute");
	}
	if (abs < 60 * 60 * 24) {
		return RELATIVE_FORMAT.format(Math.round(diffSeconds / 3600), "hour");
	}

	return RELATIVE_FORMAT.format(Math.round(diffSeconds / 86400), "day");
}
