/**
 * Comment cache reducer tests.
 *
 * Why these matter: a realtime event and a mutation response both add the same
 * comment, and a reconnect can replay one. The reducers must be idempotent, or
 * the author sees their own message twice and a reply lands in the thread twice.
 */

import { describe, expect, it } from "bun:test";

import type { Comment, CommentThread } from "./api";
import {
	appendToPages,
	type CommentPages,
	replaceInPages,
	withTotal,
} from "./cache";

/** One comment with the fields a cache patch touches. */
function makeComment(overrides: Partial<Comment> = {}): Comment {
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

/** A one page discussion with an optional starting set of threads. */
function makePages(
	threads: CommentThread[] = [],
	total = threads.length,
): CommentPages {
	return {
		pages: [{ threads, total, nextCursor: null }],
		pageParams: [null],
	};
}

describe("appendToPages", () => {
	it("appends a root to the newest page", () => {
		const next = appendToPages(makePages(), makeComment());

		expect(next.pages[0]?.threads).toHaveLength(1);
		expect(next.pages[0]?.threads[0]?.comment.id).toBe("comment-1");
		expect(next.pages[0]?.threads[0]?.replies).toEqual([]);
	});

	it("keeps roots in arrival order", () => {
		const first = appendToPages(makePages(), makeComment({ id: "a" }));
		const second = appendToPages(first, makeComment({ id: "b" }));

		expect(second.pages[0]?.threads.map((thread) => thread.comment.id)).toEqual(
			["a", "b"],
		);
	});

	it("replaces an echoed root instead of appending it twice", () => {
		const original = makeComment({ id: "a", body: [] });
		const withRoot = appendToPages(makePages(), original);
		const echo = makeComment({
			id: "a",
			updatedAt: "2026-01-02T00:00:00.000Z",
			editedAt: "2026-01-02T00:00:00.000Z",
		});
		const next = appendToPages(withRoot, echo);

		expect(next.pages[0]?.threads).toHaveLength(1);
		expect(next.pages[0]?.threads[0]?.comment.updatedAt).toBe(echo.updatedAt);
		expect(next.pages[0]?.threads[0]?.comment.editedAt).toBe(echo.editedAt);
	});

	it("appends a reply to its parent thread", () => {
		const root = makeComment({ id: "root" });
		const pages = appendToPages(makePages(), root);
		const reply = makeComment({ id: "reply-1", parentId: "root" });
		const next = appendToPages(pages, reply);

		expect(next.pages[0]?.threads[0]?.replies).toHaveLength(1);
		expect(next.pages[0]?.threads[0]?.replies[0]?.id).toBe("reply-1");
	});

	it("replaces an echoed reply instead of appending it twice", () => {
		const root = makeComment({ id: "root" });
		const reply = makeComment({ id: "reply-1", parentId: "root" });
		const first = appendToPages(appendToPages(makePages(), root), reply);
		const echo = makeComment({
			id: "reply-1",
			parentId: "root",
			updatedAt: "2026-01-02T00:00:00.000Z",
		});
		const next = appendToPages(first, echo);

		expect(next.pages[0]?.threads[0]?.replies).toHaveLength(1);
		expect(next.pages[0]?.threads[0]?.replies[0]?.updatedAt).toBe(
			echo.updatedAt,
		);
	});

	it("ignores a reply whose root is not in the loaded pages", () => {
		const pages = makePages();
		const next = appendToPages(
			pages,
			makeComment({ id: "reply-1", parentId: "older-root" }),
		);

		expect(next.pages[0]?.threads).toEqual([]);
	});
});

describe("replaceInPages", () => {
	it("replaces a root in place", () => {
		const pages = appendToPages(makePages(), makeComment({ id: "a" }));
		const next = replaceInPages(
			pages,
			makeComment({ id: "a", deletedAt: "2026-01-03T00:00:00.000Z" }),
		);

		expect(next.pages[0]?.threads).toHaveLength(1);
		expect(next.pages[0]?.threads[0]?.comment.deletedAt).toBe(
			"2026-01-03T00:00:00.000Z",
		);
	});

	it("replaces a reply inside its thread", () => {
		const root = makeComment({ id: "root" });
		const reply = makeComment({ id: "reply-1", parentId: "root" });
		const pages = appendToPages(appendToPages(makePages(), root), reply);
		const next = replaceInPages(
			pages,
			makeComment({ id: "reply-1", parentId: "root", body: [] }),
		);

		expect(next.pages[0]?.threads[0]?.replies).toHaveLength(1);
		expect(next.pages[0]?.threads[0]?.replies[0]?.body).toEqual([]);
	});

	it("leaves the page untouched for an unknown id", () => {
		const pages = appendToPages(makePages(), makeComment({ id: "a" }));
		const next = replaceInPages(pages, makeComment({ id: "missing" }));

		expect(next.pages[0]?.threads.map((thread) => thread.comment.id)).toEqual([
			"a",
		]);
	});
});

describe("withTotal", () => {
	it("writes the count into every loaded page", () => {
		const pages: CommentPages = {
			pages: [
				{ threads: [], total: 1, nextCursor: "cursor-1" },
				{ threads: [], total: 1, nextCursor: null },
			],
			pageParams: [null, "cursor-1"],
		};
		const next = withTotal(pages, 7);

		expect(next.pages.map((page) => page.total)).toEqual([7, 7]);
		// Paging links survive; only the count changed.
		expect(next.pages[0]?.nextCursor).toBe("cursor-1");
	});
});
