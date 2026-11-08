/**
 * Control frame parsing.
 *
 * Why these matter: a control frame closes sockets. Accepting a malformed or
 * foreign payload could close a connection for the wrong tenant, so every field
 * is checked before the frame is allowed through.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { parseControlMessage } from "./control";

describe("parseControlMessage", () => {
	test("accepts an organization wide revocation", () => {
		expect(
			parseControlMessage(
				'{"type":"revoke.member","organizationId":"org-1","userId":"user-1"}',
			),
		).toEqual({
			type: "revoke.member",
			organizationId: "org-1",
			userId: "user-1",
		});
	});

	test("accepts a project scoped revocation from an object frame", () => {
		expect(
			parseControlMessage({
				type: "revoke.member",
				organizationId: "org-1",
				userId: "user-1",
				projectId: "project-1",
			}),
		).toEqual({
			type: "revoke.member",
			organizationId: "org-1",
			userId: "user-1",
			projectId: "project-1",
		});
	});

	test("rejects an unknown type", () => {
		expect(
			parseControlMessage({
				type: "revoke.organization",
				organizationId: "org-1",
				userId: "user-1",
			}),
		).toBeNull();
	});

	test("rejects a missing or empty identifier", () => {
		expect(
			parseControlMessage({ type: "revoke.member", userId: "user-1" }),
		).toBeNull();
		expect(
			parseControlMessage({
				type: "revoke.member",
				organizationId: "",
				userId: "user-1",
			}),
		).toBeNull();
		expect(
			parseControlMessage({
				type: "revoke.member",
				organizationId: "org-1",
				userId: "user-1",
				projectId: "",
			}),
		).toBeNull();
	});

	test("rejects malformed JSON and non objects", () => {
		expect(parseControlMessage("{")).toBeNull();
		expect(parseControlMessage(["revoke.member"])).toBeNull();
		expect(parseControlMessage(null)).toBeNull();
	});
});
