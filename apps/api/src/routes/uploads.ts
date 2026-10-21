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
import { canEditOrganization } from "../auth/permissions";
import { authMacro } from "../auth/plugin";
import { objectUrl, UPLOAD_PURPOSES } from "../lib/storage";
import {
	enqueueUploadVerification,
	waitForUploadVerification,
} from "../queues/upload-verification";
import {
	getOrganizationLogo,
	getOrganizationRole,
} from "../services/organization.service";
import {
	createUpload,
	deletePreviousAvatar,
	deletePreviousOrgLogo,
	getOwnedUpload,
	UploadError,
} from "../services/upload.service";

const createUploadBody = t.Object({
	purpose: t.UnionEnum(UPLOAD_PURPOSES),
	contentType: t.String({ minLength: 3, maxLength: 100 }),
	size: t.Number({ minimum: 1 }),
	/**
	 * Required for organization scoped purposes. The route checks membership
	 * and the settings role before a presigned URL is issued, so a caller
	 * cannot write into another organization's prefix.
	 */
	organizationId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
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
			const organizationId = body.organizationId?.trim();

			// Organization owned objects need a verified role before storage is
			// touched. The check lives here rather than in the service because
			// it is an HTTP permission decision, and the same check runs again
			// on completion in case the role changed in between.
			if (body.purpose === "organization-logo") {
				if (!organizationId) {
					return status(400, {
						message: "An organization is required for this upload",
					});
				}

				const role = await getOrganizationRole(user.id, organizationId);
				if (!role || !canEditOrganization(role)) {
					return status(403, {
						message: "You do not have permission to update this organization",
					});
				}
			}

			try {
				const upload = await createUpload(user.id, {
					purpose: body.purpose,
					contentType: body.contentType,
					size: body.size,
					organizationId,
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

			if (latest.purpose === "organization-logo") {
				const organizationId = latest.organizationId;

				if (!organizationId) {
					return status(400, {
						message: "The upload is not linked to an organization",
					});
				}

				// Re-check the role here. The create call may be minutes old and
				// the member could have been demoted in between.
				const role = await getOrganizationRole(user.id, organizationId);
				if (!role || !canEditOrganization(role)) {
					return status(403, {
						message: "You do not have permission to update this organization",
					});
				}

				// Read the old URL before Better Auth overwrites it, so the
				// replaced object can be removed after the write succeeds.
				const previousLogo = await getOrganizationLogo(organizationId);

				try {
					await auth.api.updateOrganization({
						body: { data: { logo: image }, organizationId },
						headers: request.headers,
					});
				} catch {
					return status(500, {
						message: "Could not update the organization logo",
					});
				}

				await deletePreviousOrgLogo(organizationId, previousLogo);
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
