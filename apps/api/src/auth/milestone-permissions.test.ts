/**
 * Milestone vocabulary, date and estimate validation, write permission.
 *
 * Why these exist: dates and estimates arrive from the browser as loose
 * strings, and the database has its own checks. This module is the friendly
 * layer in front of them, so every rule needs a pinned example, including the
 * ones that look obviously correct.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	ACTIVE_MILESTONE_STATUSES,
	canEditChangeScopeEntry,
	canLockMilestones,
	canWriteMilestones,
	canWriteReviewScope,
	canWriteTestScope,
	isMilestoneStatus,
	MILESTONE_ESTIMATE_MAX,
	MILESTONE_NOTE_MAX,
	MILESTONE_SCOPE_TITLE_MAX,
	MILESTONE_TITLE_MAX,
	milestoneStatusAcceptsNote,
	milestoneStatusNeedsNote,
	validateMilestoneDate,
	validateMilestoneDateRange,
	validateMilestoneEstimate,
	validateMilestoneNote,
	validateMilestoneScopeTitle,
	validateMilestoneStatus,
	validateMilestoneTitle,
} from "./milestone-permissions";

describe("milestone status", () => {
	test("accepts the eight product statuses", () => {
		const statuses = [
			"todo",
			"in_development",
			"in_testing",
			"ready",
			"in_review",
			"blocked",
			"done",
			"cancelled",
		] as const;

		for (const status of statuses) {
			expect(isMilestoneStatus(status)).toBe(true);
			expect(validateMilestoneStatus(status)).toBe(status);
		}
	});

	test("rejects the removed in_progress status", () => {
		expect(isMilestoneStatus("in_progress")).toBe(false);
		expect(() => validateMilestoneStatus("in_progress")).toThrow(
			/Unknown milestone status/,
		);
	});

	test("rejects an unknown or differently cased status", () => {
		expect(isMilestoneStatus("In Progress")).toBe(false);
		expect(() => validateMilestoneStatus("In Progress")).toThrow(
			/Unknown milestone status/,
		);
		expect(() => validateMilestoneStatus("")).toThrow(
			/Unknown milestone status/,
		);
	});
});

describe("validateMilestoneTitle", () => {
	test("trims and returns the title", () => {
		expect(validateMilestoneTitle("  Ship the homepage  ")).toBe(
			"Ship the homepage",
		);
	});

	test("rejects an empty title", () => {
		expect(() => validateMilestoneTitle("   ")).toThrow(/between 1 and 160/);
	});

	test("rejects a title over the limit", () => {
		expect(() =>
			validateMilestoneTitle("a".repeat(MILESTONE_TITLE_MAX + 1)),
		).toThrow(/between 1 and 160/);
	});
});

describe("validateMilestoneDate", () => {
	test("accepts a real calendar day", () => {
		expect(validateMilestoneDate("2026-02-28", "The due date")).toBe(
			"2026-02-28",
		);
		expect(validateMilestoneDate("2024-02-29", "The due date")).toBe(
			"2024-02-29",
		);
	});

	test("trims surrounding whitespace", () => {
		expect(validateMilestoneDate(" 2026-01-01 ", "The due date")).toBe(
			"2026-01-01",
		);
	});

	test("rejects a day that does not exist instead of rolling it over", () => {
		expect(() => validateMilestoneDate("2026-02-31", "The due date")).toThrow(
			/not a real day/,
		);
		expect(() => validateMilestoneDate("2025-02-29", "The due date")).toThrow(
			/not a real day/,
		);
	});

	test("rejects a value that is not in day form", () => {
		expect(() => validateMilestoneDate("2026-2-1", "The due date")).toThrow(
			/calendar day/,
		);
		expect(() => validateMilestoneDate("tomorrow", "The due date")).toThrow(
			/calendar day/,
		);
	});

	test("an empty or missing value clears the date", () => {
		expect(validateMilestoneDate("", "The due date")).toBeNull();
		expect(validateMilestoneDate(null, "The due date")).toBeNull();
		expect(validateMilestoneDate(undefined, "The due date")).toBeNull();
	});
});

describe("validateMilestoneDateRange", () => {
	test("allows a start on or before the due date", () => {
		expect(() =>
			validateMilestoneDateRange("2026-01-01", "2026-01-01"),
		).not.toThrow();
		expect(() =>
			validateMilestoneDateRange("2026-01-01", "2026-02-01"),
		).not.toThrow();
	});

	test("rejects a start after the due date", () => {
		expect(() =>
			validateMilestoneDateRange("2026-02-02", "2026-02-01"),
		).toThrow(/cannot be after/);
	});

	test("allows one missing side", () => {
		expect(() => validateMilestoneDateRange(null, "2026-02-01")).not.toThrow();
		expect(() => validateMilestoneDateRange("2026-02-01", null)).not.toThrow();
	});
});

describe("validateMilestoneEstimate", () => {
	test("accepts a whole number of minutes", () => {
		expect(validateMilestoneEstimate(1)).toBe(1);
		expect(validateMilestoneEstimate(90)).toBe(90);
		expect(validateMilestoneEstimate("90")).toBe(90);
		expect(validateMilestoneEstimate(MILESTONE_ESTIMATE_MAX)).toBe(
			MILESTONE_ESTIMATE_MAX,
		);
	});

	test("an empty or missing value means no estimate", () => {
		expect(validateMilestoneEstimate(null)).toBeNull();
		expect(validateMilestoneEstimate(undefined)).toBeNull();
		expect(validateMilestoneEstimate("")).toBeNull();
		expect(validateMilestoneEstimate("   ")).toBeNull();
	});

	test("rejects zero, negatives, fractions and values over the cap", () => {
		expect(() => validateMilestoneEstimate(0)).toThrow(/between 1/);
		expect(() => validateMilestoneEstimate(-5)).toThrow(/between 1/);
		expect(() => validateMilestoneEstimate(12.5)).toThrow(/between 1/);
		expect(() => validateMilestoneEstimate(MILESTONE_ESTIMATE_MAX + 1)).toThrow(
			/between 1/,
		);
		expect(() => validateMilestoneEstimate("not a number")).toThrow(
			/between 1/,
		);
	});
});

describe("canWriteMilestones", () => {
	test("owners, admins and members write", () => {
		expect(canWriteMilestones("owner", null)).toBe(true);
		expect(canWriteMilestones("member", "owner")).toBe(true);
		expect(canWriteMilestones("member", "admin")).toBe(true);
		expect(canWriteMilestones("member", "member")).toBe(true);
	});

	test("a client never writes", () => {
		expect(canWriteMilestones("member", "client")).toBe(false);
		expect(canWriteMilestones("admin", "client")).toBe(false);
	});

	test("an organization owner still writes through the owner overlay", () => {
		expect(canWriteMilestones("owner", "client")).toBe(true);
	});

	test("no project role means no write", () => {
		expect(canWriteMilestones("member", null)).toBe(false);
	});
});

describe("canLockMilestones", () => {
	test("owners and admins lock, members and clients do not", () => {
		expect(canLockMilestones("member", "owner")).toBe(true);
		expect(canLockMilestones("member", "admin")).toBe(true);
		expect(canLockMilestones("member", "member")).toBe(false);
		expect(canLockMilestones("member", "client")).toBe(false);
	});

	test("an organization owner locks through the owner overlay", () => {
		expect(canLockMilestones("owner", "client")).toBe(true);
	});
});

describe("active milestone statuses", () => {
	test("the working states are active and the terminal ones are not", () => {
		expect(ACTIVE_MILESTONE_STATUSES).toContain("todo");
		expect(ACTIVE_MILESTONE_STATUSES).toContain("in_development");
		expect(ACTIVE_MILESTONE_STATUSES).toContain("in_testing");
		expect(ACTIVE_MILESTONE_STATUSES).toContain("ready");
		expect(ACTIVE_MILESTONE_STATUSES).toContain("in_review");
		expect(ACTIVE_MILESTONE_STATUSES).toContain("blocked");
		expect(ACTIVE_MILESTONE_STATUSES).not.toContain("done");
		expect(ACTIVE_MILESTONE_STATUSES).not.toContain("cancelled");
	});
});

describe("scope section permissions", () => {
	test("only staff write testing findings, and only in testing", () => {
		expect(canWriteTestScope("member", "member", "in_testing")).toBe(true);
		expect(canWriteTestScope("member", "client", "in_testing")).toBe(false);
		expect(canWriteTestScope("member", "member", "ready")).toBe(false);
		expect(canWriteTestScope("member", "member", "in_review")).toBe(false);
	});

	test("every project member writes review notes, and only in review", () => {
		expect(canWriteReviewScope("member", "client", "in_review")).toBe(true);
		expect(canWriteReviewScope("member", "member", "in_review")).toBe(true);
		expect(canWriteReviewScope("member", "client", "in_testing")).toBe(false);
		expect(canWriteReviewScope("member", null, "in_review")).toBe(false);
	});

	test("an accepted change follows the normal milestone write rule", () => {
		expect(canEditChangeScopeEntry("member", "member")).toBe(true);
		expect(canEditChangeScopeEntry("member", "client")).toBe(false);
		expect(canEditChangeScopeEntry("owner", "client")).toBe(true);
	});
});

describe("milestoneStatusNeedsNote", () => {
	test("only blocked requires a reason", () => {
		expect(milestoneStatusNeedsNote("blocked")).toBe(true);
		expect(milestoneStatusNeedsNote("cancelled")).toBe(false);
		expect(milestoneStatusNeedsNote("done")).toBe(false);
	});

	test("blocked and cancelled accept one", () => {
		expect(milestoneStatusAcceptsNote("blocked")).toBe(true);
		expect(milestoneStatusAcceptsNote("cancelled")).toBe(true);
		expect(milestoneStatusAcceptsNote("in_review")).toBe(false);
	});
});

describe("validateMilestoneScopeTitle", () => {
	test("trims and keeps a title", () => {
		expect(validateMilestoneScopeTitle("  Contact page  ")).toBe(
			"Contact page",
		);
	});

	test("rejects an empty or oversized title", () => {
		expect(() => validateMilestoneScopeTitle("   ")).toThrow(/between 1 and/);
		expect(() =>
			validateMilestoneScopeTitle("a".repeat(MILESTONE_SCOPE_TITLE_MAX + 1)),
		).toThrow(/between 1 and/);
	});
});

describe("validateMilestoneNote", () => {
	test("trims a note and keeps its text", () => {
		expect(validateMilestoneNote("  Waiting on the API key  ")).toBe(
			"Waiting on the API key",
		);
	});

	test("an empty or missing note is null", () => {
		expect(validateMilestoneNote(null)).toBeNull();
		expect(validateMilestoneNote(undefined)).toBeNull();
		expect(validateMilestoneNote("   ")).toBeNull();
	});

	test("rejects a note over the limit", () => {
		expect(() =>
			validateMilestoneNote("a".repeat(MILESTONE_NOTE_MAX + 1)),
		).toThrow(/characters or fewer/);
	});
});
