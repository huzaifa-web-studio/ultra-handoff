/**
 * Notification cursor tests.
 *
 * Why: the cursor is public input. It has to round trip the exact stored
 * timestamp, including microseconds, and every malformed shape has to be a 400
 * rather than an empty page. Buffer decoding never throws, so these pin the
 * validation that sits behind it.
 */

import { describe, expect, test } from "bun:test";

import {
	decodeNotificationCursor,
	encodeNotificationCursor,
} from "./notification-query";

const id = "3f1a2b3c-0000-4000-8000-000000000001";

/** Encode an arbitrary payload the way an attacker or an old build might. */
function encodeRaw(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

describe("notification cursor", () => {
	test("round trips the exact position", () => {
		const cursor = encodeNotificationCursor("2026-11-23 07:23:33.123456", id);

		expect(decodeNotificationCursor(cursor)).toEqual({
			createdAt: "2026-11-23 07:23:33.123456",
			id,
		});
	});

	test("keeps microsecond precision", () => {
		const cursor = encodeNotificationCursor("2026-11-23 07:23:33.123457", id);

		expect(decodeNotificationCursor(cursor)?.createdAt).toBe(
			"2026-11-23 07:23:33.123457",
		);
	});

	test("round trips a timestamp without a fractional part", () => {
		const cursor = encodeNotificationCursor("2026-11-23 07:23:33", id);

		expect(decodeNotificationCursor(cursor)?.createdAt).toBe(
			"2026-11-23 07:23:33",
		);
	});

	const rejected: Array<[string, string]> = [
		["plain text", "not a cursor"],
		["a bare id", id],
		["an empty string", ""],
		["an array", JSON.stringify([1, 2, 3])],
		["missing the id", JSON.stringify({ t: "2026-11-23 07:23:33.1" })],
		["a non timestamp t", JSON.stringify({ t: "yesterday", i: id })],
		["a non uuid id", JSON.stringify({ t: "2026-11-23 07:23:33.1", i: "abc" })],
		[
			"a truncated timestamp",
			JSON.stringify({ t: "2026-11-23T07:23:33Z", i: id }),
		],
		[
			"too many fractional digits",
			JSON.stringify({ t: "2026-11-23 07:23:33.1234567", i: id }),
		],
	];

	for (const [label, payload] of rejected) {
		test(`rejects ${label}`, () => {
			expect(decodeNotificationCursor(encodeRaw(payload))).toBeNull();
		});
	}

	test("rejects a value that is too long", () => {
		expect(decodeNotificationCursor("a".repeat(400))).toBeNull();
	});
});
