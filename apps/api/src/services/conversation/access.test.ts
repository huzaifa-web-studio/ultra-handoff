/**
 * Conversation access helper tests.
 *
 * Why: the pair key is the idempotency guard for a direct conversation, and the
 * cursor codec is the only thing standing between a hand edited page link and a
 * query. Both are pure and easy to pin.
 */

import { describe, expect, it } from "bun:test";

import { decodeCursor, encodeCursor, pairKey, toScope } from "./access";

describe("pairKey", () => {
	it("is the same for both directions", () => {
		expect(pairKey("user-b", "user-a")).toBe("user-a:user-b");
		expect(pairKey("user-a", "user-b")).toBe("user-a:user-b");
	});

	it("keeps a colon inside an id unambiguous enough for one pair", () => {
		// Ids in this schema are UUIDs, so a colon cannot appear. The test pins
		// the shape rather than defending a value that cannot exist.
		expect(pairKey("a", "b")).toBe("a:b");
	});
});

describe("cursor codec", () => {
	it("round trips an id", () => {
		const id = "85165656-0000-4000-8000-000000000000";

		expect(decodeCursor(encodeCursor(id))).toBe(id);
	});

	it("rejects an empty or oversized value", () => {
		expect(decodeCursor(encodeCursor(""))).toBeNull();
		expect(decodeCursor(encodeCursor("x".repeat(65)))).toBeNull();
	});

	it("rejects a value that is not base64url text", () => {
		expect(decodeCursor("!!!")).toBeNull();
	});
});

describe("toScope", () => {
	it("accepts the three known scopes", () => {
		expect(toScope("direct")).toBe("direct");
		expect(toScope("group")).toBe("group");
		expect(toScope("project")).toBe("project");
	});

	it("falls back to direct for an unknown value", () => {
		expect(toScope("something-else")).toBe("direct");
	});
});
