/**
 * Channel validation tests.
 *
 * Why: these rules are the only thing standing between a pasted name and a row
 * that breaks a bell sentence or a URL. They are pure, so they run without a
 * database.
 *
 * Used by: the API test suite.
 */

import { describe, expect, it } from "bun:test";

import {
	normalizeChannelDescription,
	normalizeChannelTitle,
	normalizeMemberIds,
	normalizeVisibility,
} from "./validate";

describe("normalizeChannelTitle", () => {
	it("trims, collapses whitespace and drops a leading hash", () => {
		expect(normalizeChannelTitle("  #  design   review  ")).toBe(
			"design review",
		);
	});

	it("rejects an empty name", () => {
		expect(() => normalizeChannelTitle("   ")).toThrow(
			"Give the channel a name.",
		);
		expect(() => normalizeChannelTitle("#")).toThrow(
			"Give the channel a name.",
		);
	});

	it("rejects a name over the limit", () => {
		expect(() => normalizeChannelTitle("a".repeat(81))).toThrow(
			"at most 80 characters",
		);
	});

	it("strips control characters instead of storing them", () => {
		expect(normalizeChannelTitle("de\u0000sign")).toBe("de sign");
	});
});

describe("normalizeChannelDescription", () => {
	it("turns null and blank into null", () => {
		expect(normalizeChannelDescription(null)).toBeNull();
		expect(normalizeChannelDescription("   ")).toBeNull();
	});

	it("keeps a valid topic", () => {
		expect(normalizeChannelDescription("  Design reviews  ")).toBe(
			"Design reviews",
		);
	});

	it("rejects a topic over the limit", () => {
		expect(() => normalizeChannelDescription("a".repeat(281))).toThrow(
			"at most 280 characters",
		);
	});
});

describe("normalizeMemberIds", () => {
	it("dedupes, drops blanks and never includes the creator", () => {
		expect(
			normalizeMemberIds(
				["user-2", " user-2 ", "", "user-3", "user-1"],
				"user-1",
			),
		).toEqual(["user-2", "user-3"]);
	});

	it("accepts an empty list", () => {
		expect(normalizeMemberIds(undefined, "user-1")).toEqual([]);
	});

	it("rejects more members than the cap allows", () => {
		const ids = Array.from({ length: 100 }, (_, index) => `user-${index + 2}`);

		expect(() => normalizeMemberIds(ids, "user-1")).toThrow(
			"at most 100 members",
		);
	});
});

describe("normalizeVisibility", () => {
	it("accepts the two known values", () => {
		expect(normalizeVisibility("public")).toBe("public");
		expect(normalizeVisibility("private")).toBe("private");
	});

	it("rejects anything else", () => {
		expect(() => normalizeVisibility("secret")).toThrow("public or private");
	});
});
