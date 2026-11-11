/**
 * Change request vocabulary and permission rules.
 *
 * Why these exist: the difference between "the client may ask" and "the client
 * may decide" is the whole safety property of the Changes surface. Every rule
 * gets a pinned example so a later refactor cannot quietly widen it.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	CHANGE_REQUEST_TITLE_MAX,
	canCreateChangeRequest,
	canDecideChangeRequest,
	canEditChangeRequest,
	canWithdrawChangeRequest,
	isChangeRequestStatus,
	validateChangeRequestStatus,
	validateChangeRequestTitle,
} from "./change-request-permissions";

describe("change request status", () => {
	test("accepts the five statuses", () => {
		const statuses = [
			"open",
			"accepted",
			"declined",
			"moved",
			"withdrawn",
		] as const;

		for (const status of statuses) {
			expect(isChangeRequestStatus(status)).toBe(true);
			expect(validateChangeRequestStatus(status)).toBe(status);
		}
	});

	test("rejects an unknown status", () => {
		expect(isChangeRequestStatus("pending")).toBe(false);
		expect(() => validateChangeRequestStatus("pending")).toThrow(
			/Unknown change request status/,
		);
	});
});

describe("validateChangeRequestTitle", () => {
	test("trims and returns the title", () => {
		expect(validateChangeRequestTitle("  Add a form  ")).toBe("Add a form");
	});

	test("rejects an empty title", () => {
		expect(() => validateChangeRequestTitle("   ")).toThrow(/between 1 and/);
	});

	test("rejects a title over the limit", () => {
		expect(() =>
			validateChangeRequestTitle("a".repeat(CHANGE_REQUEST_TITLE_MAX + 1)),
		).toThrow(/between 1 and/);
	});
});

describe("canCreateChangeRequest", () => {
	test("every project role may ask, the client included", () => {
		expect(canCreateChangeRequest("member", "owner")).toBe(true);
		expect(canCreateChangeRequest("member", "admin")).toBe(true);
		expect(canCreateChangeRequest("member", "member")).toBe(true);
		expect(canCreateChangeRequest("member", "client")).toBe(true);
	});

	test("someone outside the project may not ask", () => {
		expect(canCreateChangeRequest("member", null)).toBe(false);
	});
});

describe("canDecideChangeRequest", () => {
	test("staff decide, the client does not", () => {
		expect(canDecideChangeRequest("member", "owner")).toBe(true);
		expect(canDecideChangeRequest("member", "admin")).toBe(true);
		expect(canDecideChangeRequest("member", "member")).toBe(true);
		expect(canDecideChangeRequest("member", "client")).toBe(false);
	});

	test("no project role means no decision", () => {
		expect(canDecideChangeRequest("member", null)).toBe(false);
	});
});

describe("canEditChangeRequest and canWithdrawChangeRequest", () => {
	test("the author may edit and withdraw while the request is open", () => {
		const input = {
			viewerId: "client-1",
			requestedBy: "client-1",
			status: "open" as const,
		};

		expect(canEditChangeRequest(input)).toBe(true);
		expect(canWithdrawChangeRequest(input)).toBe(true);
	});

	test("another member may not edit the author's request", () => {
		const input = {
			viewerId: "member-1",
			requestedBy: "client-1",
			status: "open" as const,
		};

		expect(canEditChangeRequest(input)).toBe(false);
		expect(canWithdrawChangeRequest(input)).toBe(false);
	});

	test("a decided request is final", () => {
		for (const status of [
			"accepted",
			"declined",
			"moved",
			"withdrawn",
		] as const) {
			const input = { viewerId: "client-1", requestedBy: "client-1", status };

			expect(canEditChangeRequest(input)).toBe(false);
			expect(canWithdrawChangeRequest(input)).toBe(false);
		}
	});

	test("a request whose author deleted their account cannot be edited", () => {
		const input = {
			viewerId: "client-1",
			requestedBy: null,
			status: "open" as const,
		};

		expect(canEditChangeRequest(input)).toBe(false);
		expect(canWithdrawChangeRequest(input)).toBe(false);
	});
});
