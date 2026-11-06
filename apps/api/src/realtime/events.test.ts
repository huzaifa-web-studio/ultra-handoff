/**
 * Broadcast payload tests.
 *
 * The one rule worth pinning: a broadcast comment must never carry the writer's
 * capabilities. If this regresses, every reader is told they may edit somebody
 * else's comment, which is exactly the kind of bug a type alone will not catch.
 */

import { describe, expect, it } from "bun:test";

import type { CommentRow } from "../services/comment.service";
import { toRealtimeComment } from "./events";

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
