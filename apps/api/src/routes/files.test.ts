/**
 * The `/files/*` route access and response rules.
 *
 * Why these exist: the route is the only way stored bytes reach a browser, so
 * the difference between a public logo and a member gated attachment is a
 * security boundary. Storage and the membership lookup are mocked, which keeps
 * the test free of S3, Postgres and Redis.
 *
 * Run with: bun test
 */

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Elysia } from "elysia";

import * as realStorageClient from "../lib/storage/client";
import * as realTenant from "../middleware/tenant";

/** Storage mock. Every other export keeps its real implementation. */
const openObject = mock(async () => ({
	body: new Blob(["hello"]).stream(),
	contentType: "application/pdf",
	contentLength: 5,
	etag: '"etag"',
}));

const isOrganizationMember = mock(
	async (_headers: Headers, _organizationId: string) => true,
);

mock.module("../lib/storage/client.ts", () => ({
	...realStorageClient,
	openObject,
}));

mock.module("../middleware/tenant.ts", () => ({
	...realTenant,
	isOrganizationMember,
}));

// Imported after the mocks so the route picks them up.
const { fileRoutes } = await import("./files");

const app = new Elysia().use(fileRoutes);

function get(path: string): Promise<Response> {
	return app.handle(new Request(`http://localhost${path}`));
}

beforeEach(() => {
	openObject.mockClear();
	isOrganizationMember.mockClear();
	isOrganizationMember.mockResolvedValue(true);
});

afterAll(() => {
	// The storage barrel is shared with the upload and integration suites, so
	// the mock has to come down as soon as this file is done.
	mock.restore();
});

describe("public branding", () => {
	test("an avatar is served without a session", async () => {
		const response = await get("/files/avatars/user-1/avatar.png");

		expect(response.status).toBe(200);
		expect(isOrganizationMember).not.toHaveBeenCalled();
		expect(response.headers.get("Cache-Control")).toBe(
			"public, max-age=31536000, immutable",
		);
		expect(response.headers.get("Content-Disposition")).toBe("inline");
	});

	test("an organization logo is served without a session", async () => {
		const response = await get("/files/organizations/org-1/logo.png");

		expect(response.status).toBe(200);
		expect(isOrganizationMember).not.toHaveBeenCalled();
	});
});

describe("member gated attachments", () => {
	test("an unauthenticated request is a 404", async () => {
		isOrganizationMember.mockResolvedValue(false);

		const response = await get(
			"/files/organizations/org-1/comments/files/brief.pdf",
		);

		expect(response.status).toBe(404);
		expect(openObject).not.toHaveBeenCalled();
	});

	test("a member reads the file with a private cache", async () => {
		const response = await get(
			"/files/organizations/org-1/comments/files/brief.pdf",
		);

		expect(response.status).toBe(200);
		expect(isOrganizationMember).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
		);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	});

	test("an image in a milestone is member gated too", async () => {
		isOrganizationMember.mockResolvedValue(false);

		const response = await get("/files/organizations/org-1/milestones/a.png");

		expect(response.status).toBe(404);
	});

	test("an unknown key is a 404 before storage is touched", async () => {
		const response = await get("/files/private/contract.pdf");

		expect(response.status).toBe(404);
		expect(openObject).not.toHaveBeenCalled();
	});
});

describe("download disposition", () => {
	test("a comment attachment is always a download", async () => {
		const response = await get(
			"/files/organizations/org-1/comments/files/brief.pdf",
		);

		expect(response.headers.get("Content-Disposition")).toBe("attachment");
	});

	test("a milestone attachment is a download", async () => {
		const response = await get(
			"/files/organizations/org-1/milestones/files/brief.pdf",
		);

		expect(response.headers.get("Content-Disposition")).toBe("attachment");
	});

	test("a named download keeps the original file name", async () => {
		const response = await get(
			"/files/organizations/org-1/comments/files/brief.pdf?download=1&name=qa-brief.pdf",
		);

		expect(response.headers.get("Content-Disposition")).toBe(
			"attachment; filename=\"qa-brief.pdf\"; filename*=UTF-8''qa-brief.pdf",
		);
	});

	test("a name cannot inject a header", async () => {
		const response = await get(
			"/files/organizations/org-1/comments/files/brief.pdf?download=1&name=a%0d%0aX-Evil%3A%201",
		);

		const disposition = response.headers.get("Content-Disposition") ?? "";

		expect(disposition).not.toContain("\r");
		expect(disposition).not.toContain("\n");
		expect(response.headers.get("X-Evil")).toBeNull();
	});

	test("an inline image is not forced to download", async () => {
		const response = await get(
			"/files/organizations/org-1/comments/images/shot.png?name=shot.png",
		);

		expect(response.headers.get("Content-Disposition")).toBe("inline");
	});
});
