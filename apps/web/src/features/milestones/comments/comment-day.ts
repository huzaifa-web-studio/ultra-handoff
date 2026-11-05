/**
 * Day dividers for a comment list.
 *
 * Why this is a separate pure module: the main tab groups thread cards, a
 * thread groups its replies, and both need the same rule. Keeping the rule in
 * one function means a reply can never be grouped differently from a root, and
 * the whole behaviour is testable without rendering React.
 *
 * Why the output is aligned with the input: the caller renders one row per
 * timestamp and only inserts a divider where the entry is non-null. Nothing has
 * to re-bucket the array, so React keys, scroll refs and the existing
 * "load earlier" scroll correction all keep working untouched.
 *
 * Used by: comment-tab.tsx and comment-thread.tsx.
 */

import { type DayHeading, formatDayHeading, localDayKey } from "#/lib/date";

/**
 * The divider that must appear immediately above one item.
 *
 * Null means "same day as the item before", so the list keeps one continuous
 * run with no repeated heading.
 */
export type CommentDayMarker = DayHeading | null;

/**
 * One marker per timestamp, in the same order.
 *
 * `previousTimestamp` is the last item that is already rendered above this
 * list. It is used by replies, which are compared against their root comment so
 * that the first reply of a thread does not repeat the root's day.
 *
 * Performance: this runs on every render of the list, which is fine because it
 * is one pass over a page of rows. The only expensive part is `Intl` formatting
 * inside `formatDayHeading`, so results are cached per day for the duration of
 * the call. A page of twenty comments across three days formats three headings,
 * not twenty. The map is local on purpose: it must not outlive the `now` value
 * it was built against, or a heading would never flip from Today to Yesterday.
 */
export function dayMarkers(
	timestamps: string[],
	now: Date,
	previousTimestamp: string | null = null,
): CommentDayMarker[] {
	const headings = new Map<string, DayHeading>();
	let previousKey = previousTimestamp ? localDayKey(previousTimestamp) : null;

	return timestamps.map((timestamp) => {
		// Local day key only. A UTC key would put an evening comment in the
		// wrong bucket for half the world.
		const key = localDayKey(timestamp) ?? "unknown";
		let heading = headings.get(key);

		if (!heading) {
			heading = formatDayHeading(timestamp, now);
			headings.set(key, heading);
		}

		if (heading.key === previousKey) return null;

		previousKey = heading.key;

		return heading;
	});
}
