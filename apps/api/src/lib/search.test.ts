/**
 * Search helper tests.
 *
 * Why: a snippet is the only part of a search hit a reader sees before opening
 * it, and a one character query must never reach the database. Both rules are
 * pure and easy to pin.
 */

import { describe, expect, test } from "bun:test";

import { normaliseSearchTerm, snippetAround } from "./search";

describe("normaliseSearchTerm", () => {
	test("trims a usable term", () => {
		expect(normaliseSearchTerm("  handoff ")).toBe("handoff");
	});

	test("rejects an empty or one character query", () => {
		expect(normaliseSearchTerm("")).toBeNull();
		expect(normaliseSearchTerm("   ")).toBeNull();
		expect(normaliseSearchTerm("a")).toBeNull();
	});
});

describe("snippetAround", () => {
	test("returns a short text unchanged", () => {
		expect(snippetAround("Short message", "short")).toBe("Short message");
	});

	test("collapses whitespace into one line", () => {
		expect(snippetAround("hello\n\n  world", "world")).toBe("hello world");
	});

	test("keeps the match inside a long snippet", () => {
		const text = `${"a".repeat(200)} handoff ${"b".repeat(200)}`;
		const snippet = snippetAround(text, "handoff", 80);

		expect(snippet).toContain("handoff");
		expect(snippet.startsWith("...")).toBe(true);
		expect(snippet.endsWith("...")).toBe(true);
	});

	test("falls back to the start when the term is absent", () => {
		const snippet = snippetAround("a".repeat(200), "missing", 60);

		expect(snippet.endsWith("...")).toBe(true);
		expect(snippet.length).toBeLessThanOrEqual(60);
	});
});
