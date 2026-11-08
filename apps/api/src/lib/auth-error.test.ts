/**
 * Better Auth error translation.
 *
 * Why these exist: every route uses these helpers to turn a library failure
 * into a status and a message. The current fallback deliberately returns the
 * raw error message, which is useful for known API errors but is also the path
 * that could leak a driver message. Pinning the current behaviour makes that
 * trade-off explicit and gives phase 3 a regression guard.
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

	test("collapses an unexpected status to 409", () => {
		expect(authErrorStatus(new APIError(500, { message: "x" }))).toBe(409);
		expect(
			authErrorStatus(new APIError("INTERNAL_SERVER_ERROR", { message: "x" })),
		).toBe(409);
		expect(authErrorStatus(new Error("boom"))).toBe(409);
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

	test("falls back to the error message for an unmapped API error", () => {
		const error = new APIError("BAD_REQUEST", { message: "Slug is taken" });

		expect(authErrorMessage(error, "fallback")).toBe("Slug is taken");
	});

	test("returns a generic fallback for a non error", () => {
		expect(authErrorMessage("nope", "fallback")).toBe("fallback");
		expect(authErrorMessage(null, "fallback")).toBe("fallback");
	});
});
