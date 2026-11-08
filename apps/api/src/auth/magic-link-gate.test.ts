/**
 * Magic-link sign-in gate.
 *
 * Why these exist: the gate is the only thing that stops the plugin creating a
 * user for an arbitrary address, and the callback rule is what keeps a direct
 * request from landing on the API root. Both are pure, so they are cheap to
 * pin here instead of through an HTTP round trip.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	canRequestMagicLink,
	MAGIC_LINK_PATH,
	normalizeMagicLinkEmail,
	resolveMagicLinkCallback,
} from "./magic-link-gate";

const WEB_URL = "https://app.example.com";

describe("normalizeMagicLinkEmail", () => {
	test("trims and lowercases like Better Auth stores an address", () => {
		expect(normalizeMagicLinkEmail("  Person@Example.COM ")).toBe(
			"person@example.com",
		);
	});

	test("returns null for a non-string or an empty value", () => {
		expect(normalizeMagicLinkEmail(undefined)).toBeNull();
		expect(normalizeMagicLinkEmail(42)).toBeNull();
		expect(normalizeMagicLinkEmail("   ")).toBeNull();
	});
});

describe("canRequestMagicLink", () => {
	test("allows an existing user", () => {
		expect(
			canRequestMagicLink({ userExists: true, invitationPending: false }),
		).toBe(true);
	});

	test("allows a new address with a pending invitation", () => {
		expect(
			canRequestMagicLink({ userExists: false, invitationPending: true }),
		).toBe(true);
	});

	test("refuses an address with neither a user nor an invitation", () => {
		expect(
			canRequestMagicLink({ userExists: false, invitationPending: false }),
		).toBe(false);
	});
});

describe("resolveMagicLinkCallback", () => {
	test("uses the web root when the callback is missing", () => {
		expect(resolveMagicLinkCallback(undefined, WEB_URL)).toBe(`${WEB_URL}/`);
		expect(resolveMagicLinkCallback("   ", WEB_URL)).toBe(`${WEB_URL}/`);
	});

	test("keeps a trusted absolute callback unchanged", () => {
		const invitationCallback = `${WEB_URL}/invite/abc%20123?verify=1`;

		expect(resolveMagicLinkCallback(invitationCallback, WEB_URL)).toBe(
			invitationCallback,
		);
	});

	test("resolves a relative callback onto the web origin", () => {
		expect(resolveMagicLinkCallback("/invite/abc?verify=1", WEB_URL)).toBe(
			`${WEB_URL}/invite/abc?verify=1`,
		);
	});

	test("replaces a foreign origin with the web root", () => {
		expect(
			resolveMagicLinkCallback("https://evil.example/phish", WEB_URL),
		).toBe(`${WEB_URL}/`);
		expect(resolveMagicLinkCallback("//evil.example/phish", WEB_URL)).toBe(
			`${WEB_URL}/`,
		);
	});

	test("falls back for an unparsable value", () => {
		expect(resolveMagicLinkCallback("http://[::1", WEB_URL)).toBe(
			`${WEB_URL}/`,
		);
	});
});

describe("MAGIC_LINK_PATH", () => {
	test("matches the endpoint Better Auth exposes", () => {
		expect(MAGIC_LINK_PATH).toBe("/sign-in/magic-link");
	});
});
