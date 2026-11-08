/**
 * Error copy for Better Auth failures.
 *
 * Why these exist: the auth error page and the sign-in dialog must agree on
 * what each code means, especially `account_not_linked`, which points an
 * unverified local account at the verification or password path instead of
 * leaving a raw code on screen.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { resolveAuthErrorMessage } from "./error-messages";

describe("resolveAuthErrorMessage", () => {
	test("maps account_not_linked to a plain confirmation and resend path", () => {
		const message = resolveAuthErrorMessage("account_not_linked");

		expect(message).toContain("confirmation email");
		expect(message).toContain("Resend verification email");
		expect(message).toContain("nobody else can use your email");
	});

	test("prefers a mapped code over the server description", () => {
		expect(resolveAuthErrorMessage("TOKEN_EXPIRED", "Token expired")).toBe(
			"This link has expired. Request a new one.",
		);
	});

	test("falls back to the description for an unknown code", () => {
		expect(resolveAuthErrorMessage("SOMETHING_NEW", "Try again")).toBe(
			"Try again",
		);
	});

	test("shows the raw code when no description is available", () => {
		expect(resolveAuthErrorMessage("SOMETHING_NEW")).toBe(
			"Error: SOMETHING_NEW",
		);
	});

	test("returns the caller fallback when nothing is available", () => {
		expect(
			resolveAuthErrorMessage(undefined, undefined, "Sign in failed"),
		).toBe("Sign in failed");
	});
});
