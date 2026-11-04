/**
 * Permission tests for comments.
 *
 * Why these exist: "everyone on the project can comment" and "only the author
 * can change a comment" are the two rules the whole feature depends on. They
 * are pure functions, so they are cheap to pin and impossible to leave to a
 * manual click through.
 */

import { describe, expect, test } from "bun:test";
import { APIError } from "better-auth/api";

import {
	assertCanComment,
	assertCanModifyComment,
	canCommentOnProject,
	canModifyComment,
} from "./comment-permissions";

describe("canCommentOnProject", () => {
	test("a client may take part in the discussion", () => {
		expect(canCommentOnProject("member", "client")).toBe(true);
	});

	test("a plain project member may comment", () => {
		expect(canCommentOnProject("member", "member")).toBe(true);
	});

	test("an organization owner may comment without a project row", () => {
		expect(canCommentOnProject("owner", null)).toBe(true);
	});

	test("someone with no project role cannot comment", () => {
		expect(canCommentOnProject("member", null)).toBe(false);
	});
});

describe("canModifyComment", () => {
	test("the author may edit their own comment", () => {
		expect(
			canModifyComment({
				viewerId: "user-1",
				authorId: "user-1",
				deletedAt: null,
				locked: false,
			}),
		).toBe(true);
	});

	test("another member cannot edit it", () => {
		expect(
			canModifyComment({
				viewerId: "user-2",
				authorId: "user-1",
				deletedAt: null,
				locked: false,
			}),
		).toBe(false);
	});

	test("even the author cannot edit a deleted comment", () => {
		expect(
			canModifyComment({
				viewerId: "user-1",
				authorId: "user-1",
				deletedAt: new Date(),
				locked: false,
			}),
		).toBe(false);
	});

	test("an archived project freezes edits", () => {
		expect(
			canModifyComment({
				viewerId: "user-1",
				authorId: "user-1",
				deletedAt: null,
				locked: true,
			}),
		).toBe(false);
	});

	test("a comment with no author cannot be modified", () => {
		expect(
			canModifyComment({
				viewerId: "user-1",
				authorId: null,
				deletedAt: null,
				locked: false,
			}),
		).toBe(false);
	});
});

describe("assertions", () => {
	test("assertCanComment throws for a non participant", () => {
		expect(() => assertCanComment("member", null)).toThrow(APIError);
	});

	test("assertCanModifyComment explains a deleted comment", () => {
		expect(() =>
			assertCanModifyComment({
				viewerId: "user-1",
				authorId: "user-1",
				deletedAt: new Date(),
				locked: false,
			}),
		).toThrow("That comment was deleted");
	});
});
