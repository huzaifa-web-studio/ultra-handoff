/**
 * Tests for the timezone helpers used by reminders.
 *
 * The date line and a DST boundary are the two cases a hand rolled offset gets
 * wrong, so they are pinned here against `Intl`.
 *
 * Used by: lib/timezone.ts.
 */

import { describe, expect, test } from "bun:test";

import {
	dayDifference,
	formatCalendarDay,
	localClock,
	normalizeTimezone,
} from "./timezone";

describe("normalizeTimezone", () => {
	test("accepts an IANA zone", () => {
		expect(normalizeTimezone("Asia/Karachi")).toBe("Asia/Karachi");
	});

	test("rejects an unknown zone and junk", () => {
		expect(normalizeTimezone("Mars/Olympus")).toBeNull();
		expect(normalizeTimezone("UTC; drop table")).toBeNull();
		expect(normalizeTimezone(42)).toBeNull();
	});
});

describe("localClock", () => {
	test("returns the local day on the date line", () => {
		const instant = new Date("2026-11-20T20:00:00Z");
		const kiritimati = localClock(instant, "Pacific/Kiritimati");
		const pagoPago = localClock(instant, "Pacific/Pago_Pago");

		expect(kiritimati.day).toBe("2026-11-21");
		expect(pagoPago.day).toBe("2026-11-20");
	});

	test("handles a DST boundary in New York", () => {
		const before = localClock(
			new Date("2026-03-08T06:30:00Z"),
			"America/New_York",
		);
		const after = localClock(
			new Date("2026-03-08T07:30:00Z"),
			"America/New_York",
		);

		expect(before.hour).toBe(1);
		expect(after.hour).toBe(3);
	});

	test("falls back to UTC for an invalid zone", () => {
		const clock = localClock(new Date("2026-11-20T10:00:00Z"), "Not/AZone");

		expect(clock).toEqual({ day: "2026-11-20", hour: 10 });
	});
});

describe("calendar helpers", () => {
	test("counts whole calendar days across a DST change", () => {
		expect(dayDifference("2026-03-08", "2026-03-09")).toBe(1);
		expect(dayDifference("2026-11-20", "2026-11-18")).toBe(-2);
	});

	test("formats a day as day month year", () => {
		expect(formatCalendarDay("2026-11-03")).toBe("3 Nov 2026");
	});
});
