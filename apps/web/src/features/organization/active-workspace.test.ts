/**
 * The one active workspace rule.
 *
 * Why these exist: the rule is a product decision, not an implementation
 * detail. A regression here either lets a second workspace render or sends
 * every deep link home.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { decideActiveWorkspace } from "./active-workspace";

describe("decideActiveWorkspace", () => {
	test("allows a route without an organization, such as account settings", () => {
		expect(
			decideActiveWorkspace({
				activeSlug: "beta",
				activePending: false,
			}),
		).toBe("allow");
	});

	test("allows the URL organization when it is the active one", () => {
		expect(
			decideActiveWorkspace({
				urlSlug: "beta",
				activeSlug: "beta",
				activePending: false,
			}),
		).toBe("allow");
	});

	test("redirects when the URL names another organization", () => {
		expect(
			decideActiveWorkspace({
				urlSlug: "alpha",
				activeSlug: "beta",
				activePending: false,
			}),
		).toBe("redirect");
	});

	test("waits while the active organization is loading", () => {
		expect(
			decideActiveWorkspace({
				urlSlug: "alpha",
				activeSlug: null,
				activePending: true,
			}),
		).toBe("wait");
	});

	test("falls back to allowing when no active organization is known", () => {
		// A settled hook with no slug is a degraded session, not a reason to
		// blank the whole app.
		expect(
			decideActiveWorkspace({
				urlSlug: "alpha",
				activeSlug: null,
				activePending: false,
			}),
		).toBe("allow");
	});
});
