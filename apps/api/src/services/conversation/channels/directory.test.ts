/**
 * Public directory cursor tests.
 *
 * Why: the directory orders by member count descending, then name ascending,
 * then id ascending. A single id cursor would skip or repeat a row when two
 * channels share a count and a name, so the whole tuple travels in the cursor.
 * These tests pin the round trip and the rejection of anything this app did not
 * produce.
 *
 * Used by: the API test suite.
 */

import { describe, expect, it } from "bun:test";

import { decodeBrowseCursor, encodeBrowseCursor } from "./directory";

describe("browse cursor", () => {
	it("round trips the ordering tuple", () => {
		const cursor = { memberCount: 7, title: "design review", id: "abc" };

		expect(decodeBrowseCursor(encodeBrowseCursor(cursor))).toEqual(cursor);
	});

	it("rejects a value that is not base64url JSON", () => {
		expect(decodeBrowseCursor("not a cursor")).toBeNull();
		expect(decodeBrowseCursor("")).toBeNull();
	});

	it("rejects a JSON payload with the wrong shape", () => {
		const encode = (value: unknown) =>
			Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

		expect(decodeBrowseCursor(encode(null))).toBeNull();
		expect(decodeBrowseCursor(encode([]))).toBeNull();
		expect(
			decodeBrowseCursor(encode({ memberCount: "1", title: "x" })),
		).toBeNull();
		expect(
			decodeBrowseCursor(encode({ memberCount: 1, title: "x" })),
		).toBeNull();
		expect(
			decodeBrowseCursor(encode({ memberCount: -1, title: "x", id: "a" })),
		).toBeNull();
		expect(
			decodeBrowseCursor(encode({ memberCount: 1.5, title: "x", id: "a" })),
		).toBeNull();
		expect(
			decodeBrowseCursor(encode({ memberCount: 1, title: "x", id: "" })),
		).toBeNull();
	});
});
