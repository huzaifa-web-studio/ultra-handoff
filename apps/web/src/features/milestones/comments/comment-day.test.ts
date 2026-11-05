/**
 * Day divider tests.
 *
 * Why these exist: grouping is the whole feature, it is invisible when it is
 * wrong, and the two easy mistakes are both silent. A UTC key puts evening
 * comments in the wrong day, and a missing "previous day" seed puts a heading
 * inside every thread. Both are cheap to pin here and impossible to notice by
 * clicking around once the data happens to look right.
 */

import { describe, expect, test } from "bun:test";

import { localDayKey } from "#/lib/date";
import { dayMarkers } from "./comment-day";

/** Local date helper, so the tests follow the machine timezone. */
function at(
	year: number,
	month: number,
	day: number,
	hour = 12,
	minute = 0,
): Date {
	return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe("localDayKey", () => {
	test("uses the local calendar day, not the UTC day", () => {
		// 23:30 local is already the next day in UTC for a zone west of UTC.
		// The key must still follow the reader's own day.
		expect(localDayKey(at(2026, 11, 5, 23, 30))).toBe("2026-11-05");
	});

	test("keeps a local midnight on its own day", () => {
		expect(localDayKey(at(2026, 11, 6, 0, 1))).toBe("2026-11-06");
	});

	test("returns null for a value that cannot be parsed", () => {
		expect(localDayKey("not a date")).toBeNull();
	});
});

describe("dayMarkers", () => {
	const now = at(2026, 11, 5);

	test("marks the first item and skips the rest of the same day", () => {
		const markers = dayMarkers(
			[at(2026, 11, 5, 9).toISOString(), at(2026, 11, 5, 18).toISOString()],
			now,
		);

		expect(markers[0]?.label).toBe("Today");
		expect(markers[0]?.absolute).toBe("5 Nov 2026");
		expect(markers[1]).toBeNull();
	});

	test("marks yesterday without repeating the day before it", () => {
		const markers = dayMarkers(
			[at(2026, 11, 4, 22).toISOString(), at(2026, 11, 4, 8).toISOString()],
			now,
		);

		expect(markers[0]?.label).toBe("Yesterday");
		expect(markers[1]).toBeNull();
	});

	test("recognises yesterday across a month boundary", () => {
		const markers = dayMarkers(
			[at(2026, 11, 30, 10).toISOString()],
			at(2026, 12, 1),
		);

		expect(markers[0]?.label).toBe("Yesterday");
		expect(markers[0]?.absolute).toBe("30 Nov 2026");
	});

	test("shows only the absolute date for an older day", () => {
		const markers = dayMarkers([at(2026, 11, 3, 10).toISOString()], now);

		expect(markers[0]?.label).toBeNull();
		expect(markers[0]?.absolute).toBe("3 Nov 2026");
	});

	test("inserts one heading per day change, including a page boundary", () => {
		const markers = dayMarkers(
			[
				at(2026, 11, 4, 9).toISOString(),
				at(2026, 11, 4, 20).toISOString(),
				at(2026, 11, 5, 9).toISOString(),
				at(2026, 11, 5, 20).toISOString(),
			],
			now,
		);

		expect(markers.map((marker) => marker?.label ?? null)).toEqual([
			"Yesterday",
			null,
			"Today",
			null,
		]);
	});

	test("does not repeat the root day at the top of its replies", () => {
		const markers = dayMarkers(
			[at(2026, 11, 5, 9).toISOString()],
			now,
			at(2026, 11, 5, 8).toISOString(),
		);

		expect(markers[0]).toBeNull();
	});

	test("marks a reply that lands on a later day than its root", () => {
		const markers = dayMarkers(
			[at(2026, 11, 5, 9).toISOString(), at(2026, 11, 6, 9).toISOString()],
			now,
			at(2026, 11, 4, 8).toISOString(),
		);

		expect(markers[0]?.label).toBe("Today");
		expect(markers[1]?.label).toBeNull();
		expect(markers[1]?.absolute).toBe("6 Nov 2026");
	});

	test("groups an unparseable timestamp under one heading", () => {
		const markers = dayMarkers(["bad value", "also bad"], now);

		expect(markers[0]?.absolute).toBe("Unknown date");
		expect(markers[1]).toBeNull();
	});

	test("returns nothing for an empty list", () => {
		expect(dayMarkers([], now)).toEqual([]);
	});
});
