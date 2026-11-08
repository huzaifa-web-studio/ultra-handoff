/**
 * Upload validation before any infrastructure is touched.
 *
 * Why these exist: `createUpload` must reject a bad request before it asks Redis
 * for quota or S3 for a presigned URL. Every case here fails on the pure policy
 * checks, so the test needs no container and leaves no object behind.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { createUpload, UploadError } from "./upload.service";

const user = "qa-upload-user";
const org = "qa-upload-org";

/** Assert an UploadError with a stable code and a readable message. */
async function expectUploadError(
	promise: Promise<unknown>,
	code: UploadError["code"],
	pattern: RegExp,
): Promise<void> {
	try {
		await promise;
		throw new Error("expected the upload to be rejected");
	} catch (error) {
		expect(error).toBeInstanceOf(UploadError);

		const uploadError = error as UploadError;
		expect(uploadError.code).toBe(code);
		expect(uploadError.message).toMatch(pattern);
	}
}

describe("createUpload policy checks", () => {
	test("rejects a mismatched content type for an avatar", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "avatar",
				contentType: "text/html",
				size: 1024,
			}),
			"unsupported",
			/not supported/,
		);
	});

	test("rejects SVG for every image purpose", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "avatar",
				contentType: "image/svg+xml",
				size: 1024,
			}),
			"unsupported",
			/not supported/,
		);
	});

	test("rejects an empty file", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "avatar",
				contentType: "image/png",
				size: 0,
			}),
			"unsupported",
			/empty/,
		);
	});

	test("rejects an avatar over the 5 MB ceiling", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "avatar",
				contentType: "image/png",
				size: 5 * 1024 * 1024 + 1,
			}),
			"too-large",
			/5 MB/,
		);
	});

	test("requires an organization for an organization owned purpose", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "organization-logo",
				contentType: "image/png",
				size: 1024,
			}),
			"unsupported",
			/organization is required/,
		);
	});

	test("rejects an organization on a user owned purpose", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "avatar",
				contentType: "image/png",
				size: 1024,
				organizationId: org,
			}),
			"unsupported",
			/does not belong to an organization/,
		);
	});

	test("rejects HTML as an attachment", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "comment-file",
				contentType: "text/html",
				size: 1024,
				organizationId: org,
			}),
			"unsupported",
			/not supported/,
		);
	});

	test("rejects a GIF where only PNG or JPEG is allowed", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "comment-image",
				contentType: "image/gif",
				size: 1024,
				organizationId: org,
			}),
			"unsupported",
			/not supported/,
		);
	});

	test("rejects an attachment over the 10 MB ceiling", async () => {
		await expectUploadError(
			createUpload(user, {
				purpose: "milestone-file",
				contentType: "application/pdf",
				size: 10 * 1024 * 1024 + 1,
				organizationId: org,
			}),
			"too-large",
			/10 MB/,
		);
	});
});
