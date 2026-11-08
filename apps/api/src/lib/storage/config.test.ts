/**
 * Upload policy table.
 *
 * Why these exist: the policy table is the only thing standing between a
 * presigned PUT and an object served from the app origin. A wrong MIME entry or
 * a prefix that trusts the client would be a stored XSS or a cross tenant
 * overwrite. These are pure checks, so they run in milliseconds.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	extensionForMime,
	isPublicFileKey,
	isUploadPurpose,
	MAX_ATTACHMENT_BYTES,
	MAX_AVATAR_BYTES,
	UPLOAD_POLICIES,
	UPLOAD_PURPOSES,
} from "./config";

describe("extensionForMime", () => {
	test("maps every allowed type to a fixed extension", () => {
		expect(extensionForMime("image/png")).toBe("png");
		expect(extensionForMime("image/jpeg")).toBe("jpg");
		expect(extensionForMime("application/pdf")).toBe("pdf");
		expect(
			extensionForMime(
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			),
		).toBe("docx");
		expect(
			extensionForMime(
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			),
		).toBe("xlsx");
	});

	test("returns null for an unknown type", () => {
		expect(extensionForMime("text/html")).toBeNull();
		expect(extensionForMime("image/svg+xml")).toBeNull();
		expect(extensionForMime("")).toBeNull();
	});
});

describe("isUploadPurpose", () => {
	test("accepts every declared purpose", () => {
		for (const purpose of UPLOAD_PURPOSES) {
			expect(isUploadPurpose(purpose)).toBe(true);
		}
	});

	test("rejects an undeclared purpose", () => {
		expect(isUploadPurpose("contract")).toBe(false);
		expect(isUploadPurpose("")).toBe(false);
	});
});

describe("isPublicFileKey", () => {
	test("allows the two public prefixes", () => {
		expect(isPublicFileKey("avatars/user-1/a.png")).toBe(true);
		expect(isPublicFileKey("organizations/org-1/projects/p.png")).toBe(true);
		expect(isPublicFileKey("organizations/org-1/comments/files/a.pdf")).toBe(
			true,
		);
	});

	test("rejects anything outside the allowlist", () => {
		expect(isPublicFileKey("private/a.pdf")).toBe(false);
		expect(isPublicFileKey("organizationsX/a.pdf")).toBe(false);
		expect(isPublicFileKey("")).toBe(false);
	});
});

describe("avatar policy", () => {
	test("allows PNG and JPEG only, never SVG", () => {
		const policy = UPLOAD_POLICIES.avatar;

		expect(policy.allowedMime).toEqual(["image/png", "image/jpeg"]);
		expect(policy.allowedMime).not.toContain("image/svg+xml");
		expect(policy.kind).toBe("image");
		expect(policy.scopedTo).toBe("user");
		expect(policy.maxBytes).toBe(MAX_AVATAR_BYTES);
	});

	test("builds a per user prefix", () => {
		expect(UPLOAD_POLICIES.avatar.prefix({ userId: "user-1" })).toBe(
			"avatars/user-1",
		);
	});
});

describe("organization scoped policies", () => {
	test("every organization purpose nests under the organization id", () => {
		for (const purpose of UPLOAD_PURPOSES) {
			const policy = UPLOAD_POLICIES[purpose];
			if (policy.scopedTo !== "organization") continue;

			const prefix = policy.prefix({ userId: "u", organizationId: "org-1" });
			expect(prefix.startsWith("organizations/org-1")).toBe(true);
		}
	});

	test("an organization purpose refuses to build without an id", () => {
		expect(() =>
			UPLOAD_POLICIES["organization-logo"].prefix({ userId: "u" }),
		).toThrow(/organization id is required/);
	});

	test("project logos, milestone files and comment files use distinct folders", () => {
		const scope = { userId: "u", organizationId: "org-1" };

		expect(UPLOAD_POLICIES["project-logo"].prefix(scope)).toBe(
			"organizations/org-1/projects",
		);
		expect(UPLOAD_POLICIES["milestone-image"].prefix(scope)).toBe(
			"organizations/org-1/milestones",
		);
		expect(UPLOAD_POLICIES["milestone-file"].prefix(scope)).toBe(
			"organizations/org-1/milestones/files",
		);
		expect(UPLOAD_POLICIES["comment-image"].prefix(scope)).toBe(
			"organizations/org-1/comments/images",
		);
		expect(UPLOAD_POLICIES["comment-file"].prefix(scope)).toBe(
			"organizations/org-1/comments/files",
		);
	});
});

describe("document policy", () => {
	test("allows the office and archive types the viewer supports", () => {
		const allowed = UPLOAD_POLICIES["comment-file"].allowedMime;

		expect(allowed).toContain("application/pdf");
		expect(allowed).toContain("text/plain");
		expect(allowed).toContain("text/csv");
		expect(allowed).toContain("application/zip");
		expect(allowed).toContain(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		expect(allowed).toContain(
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);
	});

	test("never allows HTML or SVG, which can execute from the app origin", () => {
		for (const purpose of UPLOAD_PURPOSES) {
			const policy = UPLOAD_POLICIES[purpose];

			expect(policy.allowedMime).not.toContain("text/html");
			expect(policy.allowedMime).not.toContain("application/xhtml+xml");
			expect(policy.allowedMime).not.toContain("image/svg+xml");
		}
	});

	test("attachments share the larger ceiling, images keep the smaller one", () => {
		expect(UPLOAD_POLICIES["comment-file"].maxBytes).toBe(MAX_ATTACHMENT_BYTES);
		expect(UPLOAD_POLICIES["milestone-file"].maxBytes).toBe(
			MAX_ATTACHMENT_BYTES,
		);
		expect(UPLOAD_POLICIES["comment-image"].maxBytes).toBe(MAX_AVATAR_BYTES);
	});
});
