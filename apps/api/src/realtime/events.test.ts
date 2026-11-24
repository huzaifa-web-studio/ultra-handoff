/**
 * Broadcast payload tests.
 *
 * The one rule worth pinning: a broadcast comment must never carry the writer's
 * capabilities. If this regresses, every reader is told they may edit somebody
 * else's comment, which is exactly the kind of bug a type alone will not catch.
 */

import { describe, expect, it } from "bun:test";

import type { ChangeRequestRow } from "../services/change-request.service";
import type { CommentRow } from "../services/comment";
import type { MilestoneSummary } from "../services/milestone";
import {
	toRealtimeChangeRequest,
	toRealtimeComment,
	toRealtimeMilestone,
} from "./events";

function makeRow(overrides: Partial<CommentRow> = {}): CommentRow {
	return {
		id: "comment-1",
		parentId: null,
		kind: "comment",
		event: null,
		body: [{ type: "p", children: [{ text: "hello" }] }],
		author: { id: "user-1", name: "Ayesha", image: null },
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		editedAt: null,
		deletedAt: null,
		canEdit: true,
		canDelete: true,
		...overrides,
	};
}

describe("toRealtimeComment", () => {
	it("drops the viewer capabilities", () => {
		const result = toRealtimeComment(makeRow());

		expect("canEdit" in result).toBe(false);
		expect("canDelete" in result).toBe(false);
	});

	it("keeps every field a cache patch needs", () => {
		const row = makeRow({
			parentId: "root-1",
			editedAt: "2026-01-02T00:00:00.000Z",
		});
		const result = toRealtimeComment(row);

		expect(result.id).toBe(row.id);
		expect(result.parentId).toBe(row.parentId);
		expect(result.kind).toBe(row.kind);
		expect(result.event).toBe(row.event);
		expect(result.body).toEqual(row.body);
		expect(result.author).toEqual(row.author);
		expect(result.createdAt).toBe(row.createdAt);
		expect(result.updatedAt).toBe(row.updatedAt);
		expect(result.editedAt).toBe(row.editedAt);
		expect(result.deletedAt).toBe(row.deletedAt);
	});
});

/** One summary, matching the columns the list renders. */
function makeSummary(
	overrides: Partial<MilestoneSummary> = {},
): MilestoneSummary {
	return {
		id: "milestone-1",
		projectId: "project-1",
		title: "Design",
		status: "todo",
		startDate: null,
		dueDate: "2026-01-10",
		estimateMinutes: 60,
		assignees: [],
		lockedAt: null,
		lockedByName: null,
		openChangeRequestCount: 0,
		completedAt: null,
		createdBy: "user-1",
		createdByName: "Ayesha",
		updatedBy: "user-1",
		updatedByName: "Ayesha",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("toRealtimeMilestone", () => {
	it("drops the rich text body a detail carries", () => {
		// A create returns a detail. Typed as a summary, it would still ship the
		// body at runtime, which is what this mapper exists to prevent.
		const detail = {
			...makeSummary(),
			description: [{ type: "p", children: [{ text: "hidden" }] }],
		};

		const result = toRealtimeMilestone(detail);

		expect("description" in result).toBe(false);
		expect(result.id).toBe(detail.id);
	});

	it("keeps every field the list and detail merge need", () => {
		const summary = makeSummary({ title: "Build" });
		const result = toRealtimeMilestone(summary);

		expect(result).toEqual(summary);
	});
});

/** One change request, matching the columns the Changes tab renders. */
function makeChangeRequest(
	overrides: Partial<ChangeRequestRow> = {},
): ChangeRequestRow {
	return {
		id: "change-1",
		projectId: "project-1",
		milestoneId: "milestone-1",
		title: "Add a contact form",
		body: [{ type: "p", children: [{ text: "Please add one" }] }],
		status: "open",
		requestedBy: { id: "client-1", name: "Sara", image: null },
		decidedBy: null,
		decidedAt: null,
		decisionNote: null,
		targetMilestoneId: null,
		targetMilestoneTitle: null,
		scopeEntryId: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		canEdit: true,
		canWithdraw: true,
		...overrides,
	};
}

describe("toRealtimeChangeRequest", () => {
	it("drops the viewer capabilities", () => {
		const result = toRealtimeChangeRequest(makeChangeRequest());

		expect("canEdit" in result).toBe(false);
		expect("canWithdraw" in result).toBe(false);
	});

	it("keeps every field a cache patch needs", () => {
		const row = makeChangeRequest({
			status: "moved",
			targetMilestoneId: "milestone-2",
			targetMilestoneTitle: "Contact form",
		});
		const result = toRealtimeChangeRequest(row);

		expect("canEdit" in result).toBe(false);
		expect("canWithdraw" in result).toBe(false);
		expect(result.id).toBe(row.id);
		expect(result.title).toBe(row.title);
		expect(result.body).toEqual(row.body);
		expect(result.status).toBe("moved");
		expect(result.targetMilestoneId).toBe("milestone-2");
		expect(result.targetMilestoneTitle).toBe("Contact form");
	});
});
