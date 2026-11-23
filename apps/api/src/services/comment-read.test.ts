/**
 * Tests for the in-memory unread calculation.
 *
 * The cursor is matched by id, not by timestamp, because Postgres keeps
 * microseconds and JavaScript keeps milliseconds. These cases pin that rule and
 * the exclusions for own messages, events and deleted rows.
 *
 * Used by: services/comment-read.service.ts.
 */

import { describe, expect, test } from "bun:test";

import {
	computeThreadUnread,
	type ReadableComment,
} from "./comment-read.service";

const baseline = new Date("2026-11-01T00:00:00Z");

function comment(
	id: string,
	overrides: Partial<ReadableComment> = {},
): ReadableComment {
	return {
		id,
		authorId: "other",
		kind: "comment",
		createdAt: new Date(`2026-11-02T10:00:00Z`),
		deletedAt: null,
		...overrides,
	};
}

describe("computeThreadUnread", () => {
	test("counts everything after the baseline with no cursor", () => {
		const result = computeThreadUnread({
			comments: [
				comment("a", { createdAt: new Date("2026-10-31T10:00:00Z") }),
				comment("b"),
				comment("c"),
			],
			viewerId: "me",
			baselineAt: baseline,
			cursorId: null,
		});

		expect(result).toEqual({ count: 2, firstUnreadCommentId: "b" });
	});

	test("starts after the cursor id, even when timestamps tie", () => {
		const same = new Date("2026-11-02T10:00:00Z");
		const result = computeThreadUnread({
			comments: [
				comment("a", { createdAt: same }),
				comment("b", { createdAt: same }),
				comment("c", { createdAt: same }),
			],
			viewerId: "me",
			baselineAt: baseline,
			cursorId: "b",
		});

		expect(result).toEqual({ count: 1, firstUnreadCommentId: "c" });
	});

	test("ignores own messages, events and deleted rows", () => {
		const result = computeThreadUnread({
			comments: [
				comment("a"),
				comment("mine", { authorId: "me" }),
				comment("event", { kind: "event" }),
				comment("gone", { deletedAt: new Date() }),
				comment("b"),
			],
			viewerId: "me",
			baselineAt: baseline,
			cursorId: null,
		});

		expect(result).toEqual({ count: 2, firstUnreadCommentId: "a" });
	});

	test("reports caught up as a zero count and no boundary", () => {
		const result = computeThreadUnread({
			comments: [comment("a"), comment("b")],
			viewerId: "me",
			baselineAt: baseline,
			cursorId: "b",
		});

		expect(result).toEqual({ count: 0, firstUnreadCommentId: null });
	});
});
