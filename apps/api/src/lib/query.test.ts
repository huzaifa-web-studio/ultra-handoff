/**
 * LIKE pattern escaping.
 *
 * Why these exist: every search box builds an `ILIKE '%term%'` pattern from user
 * input. Without escaping, a `%` turns the search into "match everything" and a
 * trailing backslash makes Postgres reject the query. The helper is tiny, which
 * is exactly why it is easy to break.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { escapeLike } from "./query";

describe("escapeLike", () => {
	test("leaves ordinary text alone", () => {
		expect(escapeLike("website redesign")).toBe("website redesign");
		expect(escapeLike("café")).toBe("café");
	});

	test("escapes percent so it is literal", () => {
		expect(escapeLike("50%")).toBe("50\\%");
		expect(escapeLike("%")).toBe("\\%");
	});

	test("escapes underscore so it is literal", () => {
		expect(escapeLike("a_b")).toBe("a\\_b");
	});

	test("escapes the backslash itself exactly once", () => {
		expect(escapeLike("a\\b")).toBe("a\\\\b");
	});

	test("escapes a combination in one pass", () => {
		expect(escapeLike("100%_done\\")).toBe("100\\%\\_done\\\\");
	});
});
