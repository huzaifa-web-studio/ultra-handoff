/**
 * Tab key and URL contract tests.
 *
 * Why these exist: a tab key is written to local storage and to the URL, and a
 * prefix that drifts between the two turns a deep link into a silent redirect.
 * These pin the round trip and the fallbacks.
 */

import { describe, expect, it } from "bun:test";

import {
	COMMENT_TAB_PREFIX,
	commentTabId,
	commentTabKey,
	isCommentTabKey,
	isMilestoneTabKey,
	isScopeTabKey,
	parseMilestoneTabSearch,
	resolveMilestoneTab,
	SCOPE_TAB_PREFIX,
	scopeTabId,
	scopeTabKey,
	toMilestoneTabSearchValue,
} from "./tabs";

describe("scopeTabKey", () => {
	it("round trips a section id", () => {
		const key = scopeTabKey("4f1a2b3c-0000-4000-8000-000000000000");

		expect(key.startsWith(SCOPE_TAB_PREFIX)).toBe(true);
		expect(scopeTabId(key)).toBe("4f1a2b3c-0000-4000-8000-000000000000");
		expect(isScopeTabKey(key)).toBe(true);
	});

	it("rejects an id with characters the URL would not survive", () => {
		expect(scopeTabId("scope:has space")).toBeNull();
		expect(scopeTabId("scope:../../etc/passwd")).toBeNull();
		expect(scopeTabId("comment:abc")).toBeNull();
	});

	it("accepts the baseline id", () => {
		expect(scopeTabId("scope:baseline")).toBe("baseline");
	});
});

describe("commentTabKey", () => {
	it("round trips a thread id", () => {
		const key = commentTabKey("85165656-0000-4000-8000-000000000000");

		expect(key.startsWith(COMMENT_TAB_PREFIX)).toBe(true);
		expect(commentTabId(key)).toBe("85165656-0000-4000-8000-000000000000");
		expect(isCommentTabKey(key)).toBe(true);
	});

	it("rejects a malformed id and the wrong prefix", () => {
		expect(commentTabId("comment:")).toBeNull();
		expect(commentTabId("comment:has space")).toBeNull();
		expect(commentTabId("comment:../../etc/passwd")).toBeNull();
		expect(commentTabId("scope:abc")).toBeNull();
		expect(commentTabId("comments")).toBeNull();
		expect(isCommentTabKey("comment:")).toBe(false);
	});
});

describe("resolveMilestoneTab", () => {
	it("keeps a fixed tab", () => {
		const open = new Set<never>();

		expect(resolveMilestoneTab("overview", open)).toBe("overview");
		expect(resolveMilestoneTab("scope", open)).toBe("scope");
	});

	it("keeps a reader tab that is open", () => {
		const open = new Set([
			"scope:abc" as const,
			`${COMMENT_TAB_PREFIX}def` as const,
		]);

		expect(resolveMilestoneTab("scope:abc", open)).toBe("scope:abc");
		expect(resolveMilestoneTab("comment:def", open)).toBe("comment:def");
	});

	it("falls back to the parent tab when the reader tab is missing", () => {
		const open = new Set<never>();

		expect(resolveMilestoneTab("scope:abc", open)).toBe("scope");
		expect(resolveMilestoneTab("comment:def", open)).toBe("comments");
	});
});

describe("the URL contract", () => {
	it("accepts every known tab and drops overview", () => {
		expect(parseMilestoneTabSearch("changes")).toBe("changes");
		expect(parseMilestoneTabSearch("scope:abc")).toBe("scope:abc");
		expect(parseMilestoneTabSearch("comment:abc")).toBe("comment:abc");
		expect(parseMilestoneTabSearch("overview")).toBeNull();
	});

	it("drops anything malformed", () => {
		expect(parseMilestoneTabSearch("scope:has space")).toBeNull();
		expect(parseMilestoneTabSearch("settings")).toBeNull();
		expect(parseMilestoneTabSearch(42)).toBeNull();
	});

	it("keeps the default tab out of the URL", () => {
		expect(toMilestoneTabSearchValue("overview")).toBeNull();
		expect(toMilestoneTabSearchValue("scope:abc")).toBe("scope:abc");
	});

	it("recognises a full tab key", () => {
		expect(isMilestoneTabKey("scope:abc")).toBe(true);
		expect(isMilestoneTabKey("scope:")).toBe(false);
		expect(isMilestoneTabKey(null)).toBe(false);
	});
});
