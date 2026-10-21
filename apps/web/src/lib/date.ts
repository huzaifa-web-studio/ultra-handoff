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

/** Local date, for example "21 Oct 2026". */
export function formatDate(value: string | Date): string {
	return DATE_FORMAT.format(new Date(value));
}

/** Full local date and time, used as the title of a relative label. */
export function formatDateTime(value: string | Date): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
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
	const target = new Date(value).getTime();
	const diffSeconds = Math.round((target - now.getTime()) / 1000);
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
