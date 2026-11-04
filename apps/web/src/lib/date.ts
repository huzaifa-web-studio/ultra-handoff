/**
 * Date formatting shared by every surface that shows a date.
 *
 * Why one module: dates appear in tables, detail panes, milestone labels and
 * hover titles. Keeping the format rules here means the whole product always
 * shows the same order.
 *
 * The format is fixed to day month year, for example `3 Nov 2026`. The locale
 * is pinned to `en-GB` because component options alone still follow the
 * browser's order, and a US browser would print `Nov 3, 2026`.
 *
 * Used by: features/members, features/invitations, features/projects,
 * features/milestones and any date shown inside the editor.
 */

/** Locale that guarantees the day month year order. */
export const DATE_LOCALE = "en-GB";

const DATE_FORMAT = new Intl.DateTimeFormat(DATE_LOCALE, {
	dateStyle: "medium",
});

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat(DATE_LOCALE, {
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

	return new Intl.DateTimeFormat(DATE_LOCALE, {
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

/**
 * A comment timestamp that stays friendly while it is recent.
 *
 * Why not `formatRelativeTime`: a thread that is a month old would read
 * "30 days ago", which is less useful than the actual day. A comment under a
 * day old reads as elapsed time ("Just now", "4m ago", "3h ago"), and anything
 * older falls back to the full day month year and time. The caller keeps the
 * absolute value in the hover title either way.
 */
export function formatCommentTime(
	value: string | Date,
	now: Date = new Date(),
): string {
	const date = toValidDate(value);

	if (!date) return UNKNOWN_DATE;

	const diffMs = now.getTime() - date.getTime();

	// A future value means a small clock difference between client and server.
	if (diffMs < 60_000) return "Just now";

	const minutes = Math.floor(diffMs / 60_000);

	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);

	if (hours < 24) return `${hours}h ago`;

	return formatDateTime(date);
}
