/**
 * Upload routes.
 *
 * The browser never sends file bytes here. It asks for a presigned URL, PUTs
 * directly to SeaweedFS, then calls complete so the verification job can run.
 * Reads are proxied through /files so the bucket can stay private.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import { auth } from "../auth/auth";
import { authMacro } from "../auth/plugin";
import { objectUrl, UPLOAD_PURPOSES } from "../lib/storage";
import {
	enqueueUploadVerification,
	waitForUploadVerification,
} from "../queues/upload-verification";
import {
	createUpload,
	deletePreviousAvatar,
	getOwnedUpload,
	UploadError,
} from "../services/upload.service";

const createUploadBody = t.Object({
	purpose: t.UnionEnum(UPLOAD_PURPOSES),
	contentType: t.String({ minLength: 3, maxLength: 100 }),
	size: t.Number({ minimum: 1 }),
});

const uploadIdParams = t.Object({ id: t.String({ minLength: 1 }) });

export const uploadRoutes = new Elysia()
	.use(authMacro)
	/**
	 * Validate the request and return a short lived presigned PUT URL.
	 *
	 * A 201 means the URL was issued, not that a file exists. The object only
	 * becomes real after the browser PUTs to SeaweedFS and calls complete.
	 */
	.post(
		"/uploads",
		async ({ body, user, status }) => {
			try {
				const upload = await createUpload(user.id, {
					purpose: body.purpose,
					contentType: body.contentType,
					size: body.size,
				});

				return status(201, upload);
			} catch (error) {
				if (error instanceof UploadError) {
					const code = error.code === "rate-limited" ? 429 : 400;
					return status(code, { message: error.message });
				}

				return status(500, { message: "Could not prepare the upload" });
			}
		},
		{ auth: true, body: createUploadBody },
	)
	/**
	 * Verify the uploaded object and apply its purpose.
	 *
	 * Idempotent: calling it again after verification just re-applies the
	 * avatar, which is harmless and lets a timed out request recover.
	 */
	.post(
		"/uploads/:id/complete",
		async ({ params, user, request, status }) => {
			const current = await getOwnedUpload(user.id, params.id);
			if (!current) {
				return status(404, { message: "Upload not found" });
			}

			if (current.status !== "verified" && current.status !== "rejected") {
				await enqueueUploadVerification(current.id);
				// Short wait keeps the happy path to one request. A timeout is
				// fine: the client polls while the job keeps running.
				await waitForUploadVerification(current.id);
			}

			const latest = (await getOwnedUpload(user.id, params.id)) ?? current;

			if (latest.status === "rejected") {
				return status(422, {
					status: "rejected" as const,
					reason: latest.reason ?? "The upload was rejected",
				});
			}

			if (latest.status !== "verified") {
				return status(202, { status: "pending" as const });
			}

			const image = objectUrl(latest.key);

			if (latest.purpose === "avatar") {
				// Better Auth remains the only writer of the user table. The
				// request headers carry the session it needs.
				await auth.api.updateUser({
					body: { image },
					headers: request.headers,
				});
				await deletePreviousAvatar(user.id, user.image);
			}

			return { status: "verified" as const, url: image };
		},
		{ auth: true, params: uploadIdParams },
	)
	/** Polling endpoint for the case where complete timed out. */
	.get(
		"/uploads/:id",
		async ({ params, user, status }) => {
			const session = await getOwnedUpload(user.id, params.id);
			if (!session) {
				return status(404, { message: "Upload not found" });
			}

			return {
				status: session.status,
				url: session.url,
				reason: session.reason,
			};
		},
		{ auth: true, params: uploadIdParams },
	);
