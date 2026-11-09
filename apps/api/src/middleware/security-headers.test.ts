/**
 * Security header behaviour on the API.
 *
 * Why these exist: the headers are a security boundary, and the `/files/*`
 * exception is easy to break. A global CSP that overwrites the sandboxed file
 * policy would quietly remove the strongest protection the storage route has.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import { securityHeaders } from "./security-headers";

/**
 * Build a small app with the plugin and one plain route plus a `/files/` route
 * that mimics the real route's own CSP.
 *
 * The test environment is not `development`, so the CSP branch runs, which is
 * the branch production uses.
 */
const app = new Elysia()
	.use(securityHeaders)
	.get("/health", () => ({ status: "ok" }))
	.get(
		"/files/organizations/org-id/private.pdf",
		() =>
			new Response("bytes", {
				headers: {
					"Content-Security-Policy": "default-src 'none'; sandbox",
					"Content-Type": "application/pdf",
				},
			}),
	);

function get(path: string): Promise<Response> {
	return app.handle(new Request(`http://localhost${path}`));
}

describe("securityHeaders", () => {
	test("sets the common headers on a JSON route", async () => {
		const response = await get("/health");

		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(response.headers.get("x-frame-options")).toBe("DENY");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-security-policy")).toContain(
			"default-src 'none'",
		);
		expect(response.headers.get("content-security-policy")).toContain(
			"frame-ancestors 'none'",
		);
	});

	test("leaves the file route CSP untouched", async () => {
		const response = await get("/files/organizations/org-id/private.pdf");

		expect(response.headers.get("content-security-policy")).toBe(
			"default-src 'none'; sandbox",
		);
		// The other headers still apply to files.
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});
});
