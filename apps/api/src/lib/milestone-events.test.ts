/**
 * Milestone event builder tests.
 *
 * These pin the rules that are easy to get wrong without a database: a
 * reordered assignee set is not a change, an update can add and remove at the
 * same time, and clearing an estimate stays distinct from leaving it alone.
 */

import { describe, expect, it } from "bun:test";

import {
	buildAssigneeEvents,
	buildEstimateEvent,
	isMilestoneEventType,
} from "./milestone-events";

const alice = { userId: "user-a", name: "Alice" };
const bob = { userId: "user-b", name: "Bob" };
const carol = { userId: "user-c", name: "Carol" };

describe("isMilestoneEventType", () => {
	it("accepts every type the timeline writes", () => {
		expect(isMilestoneEventType("status")).toBe(true);
		expect(isMilestoneEventType("start_date")).toBe(true);
		expect(isMilestoneEventType("due_date")).toBe(true);
		expect(isMilestoneEventType("assignee_added")).toBe(true);
		expect(isMilestoneEventType("assignee_removed")).toBe(true);
		expect(isMilestoneEventType("estimate_minutes")).toBe(true);
	});

	it("rejects null and anything unknown", () => {
		expect(isMilestoneEventType(null)).toBe(false);
		expect(isMilestoneEventType("assignees")).toBe(false);
		expect(isMilestoneEventType("")).toBe(false);
	});
});

describe("buildEstimateEvent", () => {
	it("records a first estimate", () => {
		expect(buildEstimateEvent(null, 90)).toEqual({
			type: "estimate_minutes",
			from: null,
			to: "90",
		});
	});

	it("records a changed estimate", () => {
		expect(buildEstimateEvent(60, 90)).toEqual({
			type: "estimate_minutes",
			from: "60",
			to: "90",
		});
	});

	it("records a cleared estimate", () => {
		expect(buildEstimateEvent(60, null)).toEqual({
			type: "estimate_minutes",
			from: "60",
			to: null,
		});
	});

	it("does nothing when the estimate is unchanged", () => {
		expect(buildEstimateEvent(60, 60)).toBeNull();
		expect(buildEstimateEvent(null, null)).toBeNull();
	});
});

describe("buildAssigneeEvents", () => {
	it("records who was assigned", () => {
		expect(buildAssigneeEvents([], [bob])).toEqual([
			{ type: "assignee_added", from: null, to: "Bob" },
		]);
	});

	it("records who was unassigned", () => {
		expect(buildAssigneeEvents([alice, bob], [alice])).toEqual([
			{ type: "assignee_removed", from: "Bob", to: null },
		]);
	});

	it("writes both rows when one update adds and removes", () => {
		expect(buildAssigneeEvents([alice, bob], [alice, carol])).toEqual([
			{ type: "assignee_added", from: null, to: "Carol" },
			{ type: "assignee_removed", from: "Bob", to: null },
		]);
	});

	it("sorts names so the same set reads the same way", () => {
		expect(buildAssigneeEvents([], [carol, alice])).toEqual([
			{ type: "assignee_added", from: null, to: "Alice, Carol" },
		]);
	});

	it("ignores a reordered but unchanged set", () => {
		expect(buildAssigneeEvents([alice, bob], [bob, alice])).toEqual([]);
	});

	it("ignores an unchanged empty set", () => {
		expect(buildAssigneeEvents([], [])).toEqual([]);
	});
});
