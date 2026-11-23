/**
 * Push suppression policy tests.
 *
 * Why the file is loaded by path: the policy lives in `public/` as a classic
 * script so the service worker can load it with importScripts. Importing it
 * here executes it and sets the global, which is exactly what the worker sees.
 */

import { beforeAll, describe, expect, it } from "bun:test";

type Client = { url: string; visibilityState: "visible" | "hidden" };

type PushPolicy = {
	shouldSuppressPush: (clients: Client[], slug?: string | null) => boolean;
};

let policy: PushPolicy;

beforeAll(async () => {
	const url = new URL("../../../public/push-policy.js", import.meta.url);

	await import(url.href);

	policy = (globalThis as unknown as { HandoffPushPolicy: PushPolicy })
		.HandoffPushPolicy;
});

const visible = (path: string): Client => ({
	url: `https://app.test${path}`,
	visibilityState: "visible",
});

const hidden = (path: string): Client => ({
	url: `https://app.test${path}`,
	visibilityState: "hidden",
});

describe("shouldSuppressPush", () => {
	it("does not suppress when no window is visible", () => {
		expect(policy.shouldSuppressPush([hidden("/studio-a")], "studio-a")).toBe(
			false,
		);
	});

	it("suppresses when the visible window shows the same workspace", () => {
		expect(
			policy.shouldSuppressPush(
				[visible("/studio-a/projects/p1/milestones/m1")],
				"studio-a",
			),
		).toBe(true);
	});

	it("does not suppress by a visible window on another workspace", () => {
		expect(
			policy.shouldSuppressPush([visible("/studio-a/dashboard")], "studio-b"),
		).toBe(false);
	});

	it("suppresses by any visible window when the payload has no slug", () => {
		expect(policy.shouldSuppressPush([visible("/studio-a")], "")).toBe(true);
		expect(policy.shouldSuppressPush([visible("/studio-b")], null)).toBe(true);
	});

	it("reads the slug from the first path segment, not a substring", () => {
		expect(
			policy.shouldSuppressPush([visible("/studio-b/dashboard")], "studio"),
		).toBe(false);
	});

	it("tolerates a malformed client url", () => {
		const broken: Client = {
			url: "not a url",
			visibilityState: "visible",
		};

		expect(policy.shouldSuppressPush([broken], "studio-a")).toBe(false);
		expect(policy.shouldSuppressPush([broken], "")).toBe(true);
	});
});
