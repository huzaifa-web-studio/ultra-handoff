/**
 * Shell security header policy.
 *
 * Why these exist: the CSP is the one place that names every origin the browser
 * is allowed to reach. A missing API, socket or storage origin breaks the app
 * at runtime with no build error, so the policy is pinned here.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { buildSecurityHeaders } from "./security-headers";

describe("buildSecurityHeaders", () => {
	test("always sets the framing and referrer policy", () => {
		const headers = buildSecurityHeaders({
			includeContentSecurityPolicy: false,
		});

		expect(headers["Referrer-Policy"]).toBe("same-origin");
		expect(headers["X-Frame-Options"]).toBe("DENY");
		expect(headers["X-Content-Type-Options"]).toBe("nosniff");
		expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
		expect(headers["Content-Security-Policy"]).toBeUndefined();
	});

	test("builds a production policy from the configured origins", () => {
		const headers = buildSecurityHeaders({
			apiOrigin: "https://api.example.com/",
			storageOrigin: "https://storage.example.com",
			includeContentSecurityPolicy: true,
		});
		const policy = headers["Content-Security-Policy"];

		expect(policy).toContain("connect-src 'self' https://api.example.com");
		expect(policy).toContain("wss://api.example.com");
		expect(policy).toContain("https://storage.example.com");
		expect(policy).toContain("img-src 'self' data: blob: https:");
		expect(policy).toContain("https://api.example.com");
		expect(policy).toContain("style-src 'self' 'unsafe-inline'");
		expect(policy).toContain("https://fonts.googleapis.com");
		expect(policy).toContain("font-src 'self' data: https://fonts.gstatic.com");
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).toContain("object-src 'none'");
	});

	test("uses ws for an http API origin", () => {
		const headers = buildSecurityHeaders({
			apiOrigin: "http://localhost:3001",
			includeContentSecurityPolicy: true,
		});

		expect(headers["Content-Security-Policy"]).toContain(
			"ws://localhost:3001",
		);
	});

	test("omits unknown origins instead of writing empty sources", () => {
		const headers = buildSecurityHeaders({
			includeContentSecurityPolicy: true,
		});
		const policy = headers["Content-Security-Policy"];

		expect(policy).toContain("connect-src 'self'");
		expect(policy).not.toContain("undefined");
	});
});
