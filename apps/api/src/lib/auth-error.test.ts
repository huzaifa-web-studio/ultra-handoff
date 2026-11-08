/**
 * Better Auth error translation.
 *
 * Why these exist: every route uses these helpers to turn a library failure
 * into a status and a message. The trust boundary is pinned here: a client
 * status from the library may reach the browser, an unknown failure must not.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";
import { APIError } from "better-auth/api";

import {
	authErrorMessage,
	authErrorStatus,
	readAuthErrorCode,
} from "./auth-error";

describe("readAuthErrorCode", () => {
	test("reads the code from an API error body", () => {
		const error = new APIError("FORBIDDEN", {
			message: "blocked",
			code: "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER",
		});

		expect(readAuthErrorCode(error)).toBe(
			"YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER",
		);
	});

	test("returns null for a plain error", () => {
		expect(readAuthErrorCode(new Error("nope"))).toBeNull();
		expect(readAuthErrorCode("not an error")).toBeNull();
	});
});

describe("authErrorStatus", () => {
	test("maps every named status the library can throw", () => {
		expect(authErrorStatus(new APIError("BAD_REQUEST", { message: "x" }))).toBe(
			400,
		);
		expect(
			authErrorStatus(new APIError("UNAUTHORIZED", { message: "x" })),
		).toBe(401);
		expect(authErrorStatus(new APIError("FORBIDDEN", { message: "x" }))).toBe(
			403,
		);
		expect(authErrorStatus(new APIError("NOT_FOUND", { message: "x" }))).toBe(
			404,
		);
		expect(
			authErrorStatus(new APIError("UNPROCESSABLE_ENTITY", { message: "x" })),
		).toBe(422);
		expect(
			authErrorStatus(new APIError("TOO_MANY_REQUESTS", { message: "x" })),
		).toBe(429);
	});

	test("maps numeric statuses it knows", () => {
		expect(authErrorStatus(new APIError(400, { message: "x" }))).toBe(400);
		expect(authErrorStatus(new APIError(401, { message: "x" }))).toBe(401);
		expect(authErrorStatus(new APIError(403, { message: "x" }))).toBe(403);
		expect(authErrorStatus(new APIError(404, { message: "x" }))).toBe(404);
	});

	test("returns 500 for an unexpected status", () => {
		expect(authErrorStatus(new APIError(500, { message: "x" }))).toBe(500);
		expect(
			authErrorStatus(new APIError("INTERNAL_SERVER_ERROR", { message: "x" })),
		).toBe(500);
		expect(authErrorStatus(new Error("boom"))).toBe(500);
	});
});

describe("authErrorMessage", () => {
	test("prefers the mapped copy for a known code", () => {
		const error = new APIError("FORBIDDEN", {
			message: "raw library text",
			code: "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER",
		});

		expect(authErrorMessage(error, "fallback")).toBe(
			"You do not have permission to change that member.",
		);
	});

	test("falls back to the body message for a client API error", () => {
		const error = new APIError("BAD_REQUEST", { message: "Slug is taken" });

		expect(authErrorMessage(error, "fallback")).toBe("Slug is taken");
	});

	test("hides a server side API error behind the fallback", () => {
		const error = new APIError(500, {
			message: 'driver error: relation "project" does not exist',
		});

		expect(authErrorMessage(error, "Could not load the projects.")).toBe(
			"Could not load the projects.",
		);
	});

	test("hides a plain driver error behind the fallback", () => {
		const error = new Error("connect ECONNREFUSED 127.0.0.1:5432");

		expect(authErrorMessage(error, "Something went wrong.")).toBe(
			"Something went wrong.",
		);
	});

	test("returns a generic fallback for a non error", () => {
		expect(authErrorMessage("nope", "fallback")).toBe("fallback");
		expect(authErrorMessage(null, "fallback")).toBe("fallback");
	});
});
