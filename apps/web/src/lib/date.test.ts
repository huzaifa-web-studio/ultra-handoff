/**
 * Date display rules.
 *
 * Why these exist: RULES.md rule 24 requires every visible date to be day month
 * year. The helpers are the only place that rule is implemented, so they are
 * the only place it can regress. The tests run in the host timezone on purpose:
 * the functions must be correct locally, not only in UTC.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	formatCommentTime,
	formatDate,
	formatDateTime,
	formatDayHeading,
	formatRelativeTime,
	localDayKey,
} from "./date";

/** Local noon avoids a midnight boundary in any timezone. */
function localNoon(year: number, monthIndex: number, day: number): Date {
	return new Date(year, monthIndex, day, 12, 0, 0);
}

describe("formatDate", () => {
	test("prints day month year", () => {
		expect(formatDate(localNoon(2026, 10, 3))).toBe("3 Nov 2026");
	});

	test("matches the day month year shape for every month", () => {
		for (let month = 0; month < 12; month += 1) {
			const value = formatDate(localNoon(2026, month, 9));
			// en-GB prints September as "Sept", so the month token is 3 or 4
			// letters depending on the ICU data. The order is what matters.
			expect(value).toMatch(/^\d{1,2} [A-Z][a-z]{2,4} \d{4}$/);
		}
	});

	test("accepts an ISO string", () => {
		expect(formatDate("2026-11-03T12:00:00.000Z")).toContain("2026");
	});

	test("returns a readable value for an invalid date", () => {
		expect(formatDate("not a date")).toBe("Unknown date");
		expect(formatDate("")).toBe("Unknown date");
	});
});

describe("formatDateTime", () => {
	test("keeps the date order and adds the time", () => {
		const value = formatDateTime(localNoon(2026, 10, 3));

		expect(value).toContain("3 Nov 2026");
		expect(value).toContain("12:00");
	});

	test("returns a readable value for an invalid date", () => {
		expect(formatDateTime("nope")).toBe("Unknown date");
	});
});

describe("localDayKey", () => {
	test("reads the local calendar day, not the UTC day", () => {
		const lateEvening = new Date(2026, 10, 3, 23, 30);

		expect(localDayKey(lateEvening)).toBe("2026-11-03");
	});

	test("pads the month and the day", () => {
		expect(localDayKey(new Date(2026, 0, 5, 9, 0))).toBe("2026-01-05");
	});

	test("returns null for an invalid value", () => {
		expect(localDayKey("nope")).toBeNull();
	});
});

describe("formatDayHeading", () => {
	test("labels today and yesterday and always carries the absolute date", () => {
		const now = localNoon(2026, 10, 3);
		const today = formatDayHeading(localNoon(2026, 10, 3), now);
		const yesterday = formatDayHeading(localNoon(2026, 10, 2), now);
		const older = formatDayHeading(localNoon(2026, 9, 30), now);

		expect(today.label).toBe("Today");
		expect(today.absolute).toBe("3 Nov 2026");
		expect(yesterday.label).toBe("Yesterday");
		expect(older.label).toBeNull();
		expect(older.absolute).toBe("30 Oct 2026");
		expect(today.key).toBe("2026-11-03");
	});

	test("returns a safe heading for an invalid value", () => {
		const heading = formatDayHeading("nope");

		expect(heading.key).toBe("unknown");
		expect(heading.label).toBeNull();
		expect(heading.absolute).toBe("Unknown date");
	});
});

describe("formatRelativeTime", () => {
	test("describes the future and the past in the largest useful unit", () => {
		const now = localNoon(2026, 10, 3);

		expect(formatRelativeTime(new Date(now.getTime() + 30_000), now)).toBe(
			"now",
		);
		expect(formatRelativeTime(new Date(now.getTime() + 3 * 60_000), now)).toBe(
			"in 3 minutes",
		);
		expect(
			formatRelativeTime(new Date(now.getTime() + 2 * 60 * 60_000), now),
		).toBe("in 2 hours");
		expect(
			formatRelativeTime(new Date(now.getTime() + 3 * 24 * 60 * 60_000), now),
		).toBe("in 3 days");
		expect(
			formatRelativeTime(new Date(now.getTime() - 4 * 60 * 60_000), now),
		).toBe("4 hours ago");
	});

	test("returns a readable value for an invalid date", () => {
		expect(formatRelativeTime("nope")).toBe("Unknown date");
	});
});

describe("formatCommentTime", () => {
	test("stays relative for the first day and absolute afterwards", () => {
		const now = localNoon(2026, 10, 3);

		expect(formatCommentTime(new Date(now.getTime() - 20_000), now)).toBe(
			"Just now",
		);
		expect(formatCommentTime(new Date(now.getTime() - 4 * 60_000), now)).toBe(
			"4m ago",
		);
		expect(
			formatCommentTime(new Date(now.getTime() - 3 * 60 * 60_000), now),
		).toBe("3h ago");

		const older = formatCommentTime(new Date(now.getTime() - 30 * 60 * 60_000));
		expect(older).toContain("Nov 2026");
	});
});
