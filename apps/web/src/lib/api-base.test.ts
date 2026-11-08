/**
 * Tests for the shared API origin resolver.
 *
 * Why: a production bundle that silently falls back to localhost is the exact
 * P1-H3 defect. These tests pin the build time rule without needing a Vite
 * build or a browser.
 *
 * Used by: src/lib/api-base.ts.
 */

import { describe, expect, test } from "bun:test";

import { resolveApiOrigin } from "./api-base";

describe("resolveApiOrigin", () => {
	test("uses the configured origin and strips trailing slashes", () => {
		expect(resolveApiOrigin("https://api.example.com/", true)).toBe(
			"https://api.example.com",
		);
	});

	test("trims surrounding whitespace", () => {
		expect(resolveApiOrigin("  https://api.example.com  ", true)).toBe(
			"https://api.example.com",
		);
	});

	test("falls back to the local API in development", () => {
		expect(resolveApiOrigin(undefined, false)).toBe("http://localhost:3001");
		expect(resolveApiOrigin("", false)).toBe("http://localhost:3001");
		expect(resolveApiOrigin("   ", false)).toBe("http://localhost:3001");
	});

	test("throws when a production build has no origin", () => {
		expect(() => resolveApiOrigin(undefined, true)).toThrow(
			/VITE_API_URL is required/,
		);
		expect(() => resolveApiOrigin("", true)).toThrow(
			/VITE_API_URL is required/,
		);
	});
});
