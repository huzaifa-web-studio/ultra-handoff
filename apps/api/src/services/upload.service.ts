/**
 * Upload business logic.
 *
 * Why a service: routes should only deal with HTTP, and the verification
 * worker should not know how a key is built. Everything that decides "what is
 * a valid upload" lives here so the API and the worker cannot disagree.
 *
 * Used by: src/routes/uploads.ts and src/queues/upload-verification.ts.
 */

import { randomUUID } from "node:crypto";
import {
	consumeUploadQuota,
	deleteObject,
	extensionForMime,
	getUploadSession,
	keyFromFileUrl,
	newUploadId,
	objectUrl,
	saveUploadSession,
	signPutUrl,
	UPLOAD_POLICIES,
	type UploadPurpose,
	type UploadSession,
	updateUploadSession,
} from "../lib/storage";

/** Errors the route can translate into a specific HTTP status. */
export type UploadErrorCode = "unsupported" | "too-large" | "rate-limited";

export class UploadError extends Error {
	constructor(
		readonly code: UploadErrorCode,
		message: string,
	) {
		super(message);
		this.name = "UploadError";
	}
}

export type CreateUploadInput = {
	purpose: UploadPurpose;
	contentType: string;
	size: number;
	/**
	 * Required for organization scoped purposes and rejected for user scoped
	 * ones. The route verifies membership and role before calling this.
	 */
	organizationId?: string;
};

export type CreatedUpload = {
	id: string;
	key: string;
	uploadUrl: string;
	method: "PUT";
	contentType: string;
	maxBytes: number;
	expiresIn: number;
};

const PRESIGN_TTL_SECONDS = 300;

/**
 * Validate a request and issue a presigned PUT URL.
 *
 * The declared size is checked here for a fast, friendly error. The worker
 * checks the real object size later, because a presigned PUT cannot enforce a
 * body limit at the storage layer.
 */
export async function createUpload(
	userId: string,
	input: CreateUploadInput,
): Promise<CreatedUpload> {
	const policy = UPLOAD_POLICIES[input.purpose];
	const organizationId = input.organizationId?.trim();

	// A purpose declares who owns the object. Reject the two mismatches here so
	// a caller cannot write a logo into a user prefix, or an avatar into an
	// organization prefix.
	if (policy.scopedTo === "organization" && !organizationId) {
		throw new UploadError(
			"unsupported",
			"An organization is required for this upload",
		);
	}

	if (policy.scopedTo === "user" && organizationId) {
		throw new UploadError(
			"unsupported",
			"This upload does not belong to an organization",
		);
	}

	// Normalise before comparing so a valid type with parameters such as
	// `image/png; charset=binary` is still accepted, and an unsupported type
	// with parameters is still rejected.
	const contentType = input.contentType.split(";")[0]?.trim().toLowerCase();

	const extension = contentType ? extensionForMime(contentType) : null;
	if (!contentType || !extension || !policy.allowedMime.includes(contentType)) {
		throw new UploadError(
			"unsupported",
			`This file type is not supported. ${policy.label}.`,
		);
	}

	if (input.size <= 0) {
		throw new UploadError("unsupported", "The selected file is empty");
	}

	if (input.size > policy.maxBytes) {
		throw new UploadError("too-large", `Files must be ${policy.label}`);
	}

	if (!(await consumeUploadQuota(userId))) {
		throw new UploadError(
			"rate-limited",
			"Too many uploads. Please try again in a few minutes.",
		);
	}

	const id = newUploadId();
	// The key is fully server generated. The client filename is never used, so
	// a caller cannot traverse directories or overwrite another user's object.
	const key = `${policy.prefix({ userId, organizationId })}/${randomUUID()}.${extension}`;

	const session: UploadSession = {
		id,
		userId,
		purpose: input.purpose,
		organizationId,
		key,
		contentType,
		size: input.size,
		status: "pending",
		createdAt: Date.now(),
	};

	await saveUploadSession(session);

	const uploadUrl = await signPutUrl(key, contentType, PRESIGN_TTL_SECONDS);

	return {
		id,
		key,
		uploadUrl,
		method: "PUT",
		contentType,
		maxBytes: policy.maxBytes,
		expiresIn: PRESIGN_TTL_SECONDS,
	};
}

/** Load a session only when it belongs to the caller. */
export async function getOwnedUpload(
	userId: string,
	uploadId: string,
): Promise<UploadSession | null> {
	const session = await getUploadSession(uploadId);
	return session && session.userId === userId ? session : null;
}

/** Mark a job as running so a second job can see the progress. */
export function markUploadVerifying(id: string): Promise<UploadSession | null> {
	return updateUploadSession(id, { status: "verifying" });
}

/** Persist the public URL once the worker has accepted the object. */
export async function markUploadVerified(
	id: string,
): Promise<UploadSession | null> {
	const session = await getUploadSession(id);
	if (!session) return null;

	return updateUploadSession(id, {
		status: "verified",
		url: objectUrl(session.key),
		reason: undefined,
	});
}

/** Persist a rejection reason. The route returns it to the browser. */
export function markUploadRejected(
	id: string,
	reason: string,
): Promise<UploadSession | null> {
	return updateUploadSession(id, { status: "rejected", reason });
}

/**
 * Delete the avatar an upload just replaced.
 *
 * Best effort on purpose: a failed cleanup must not undo a successful avatar
 * update. Only `/files/avatars/<userId>/...` URLs are touched, so external
 * provider avatars are left alone.
 */
export async function deletePreviousAvatar(
	userId: string,
	previousImage: string | null | undefined,
): Promise<void> {
	if (!previousImage) return;

	const key = keyFromFileUrl(previousImage);
	if (!key || key.includes("..") || key.includes("//")) return;
	if (!key.startsWith(`avatars/${userId}/`)) return;

	try {
		await deleteObject(key);
	} catch {
		// Cleanup is not part of the user's success path.
	}
}

/**
 * Delete the organization logo an update or removal just replaced.
 *
 * Same best effort contract as the avatar cleanup. Only objects under this
 * organization's prefix are touched, so an external or legacy URL is never
 * deleted by mistake.
 */
export async function deletePreviousOrgLogo(
	organizationId: string,
	previousLogo: string | null | undefined,
): Promise<void> {
	if (!previousLogo) return;

	const key = keyFromFileUrl(previousLogo);
	if (!key || key.includes("..") || key.includes("//")) return;

	const prefix = `organizations/${organizationId}/`;
	if (!key.startsWith(prefix)) return;
	// Only the logo lives directly under the organization. Project logos,
	// milestone and comment attachments, and link preview assets all sit in a
	// folder, so a logo cleanup must never reach them.
	if (key.slice(prefix.length).includes("/")) return;

	try {
		await deleteObject(key);
	} catch {
		// Cleanup is not part of the success path.
	}
}

/**
 * Delete the project logo a project update or delete just replaced.
 *
 * Same best effort contract as the other cleanups. The prefix check scopes the
 * delete to this workspace's project images, so an external URL or another
 * organization's object is never touched.
 */
export async function deletePreviousProjectLogo(
	organizationId: string,
	previousLogo: string | null | undefined,
): Promise<void> {
	if (!previousLogo) return;

	const key = keyFromFileUrl(previousLogo);
	if (!key || key.includes("..") || key.includes("//")) return;
	if (!key.startsWith(`organizations/${organizationId}/projects/`)) return;

	try {
		await deleteObject(key);
	} catch {
		// Cleanup is not part of the success path.
	}
}

/** How many object deletes run at once during a content cleanup. */
const DELETE_CONCURRENCY = 5;

/**
 * How long the request waits for cleanup.
 *
 * The rows are already committed, so the delete is successful regardless of
 * what happens to the bytes. Without a bound, an unreachable storage gateway
 * would hold the HTTP response open for the SDK's full retry budget. Anything
 * left behind is picked up by the reconciliation script.
 */
const CLEANUP_DEADLINE_MS = 2_000;

/** Resolve after `ms`, even if the cleanup workers are still running. */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Delete the objects a deleted comment, milestone or project referenced.
 *
 * Why best effort: the row is already gone and the transaction has committed.
 * A storage failure must not turn a successful delete into an error, so each
 * key is attempted independently and failures are ignored. The reconciliation
 * script exists precisely to catch whatever this pass misses.
 *
 * Why bounded concurrency: a milestone delete can remove dozens of
 * attachments, and firing them all at once would open an unbounded number of
 * connections to the storage gateway.
 */
export async function deleteObjectsBestEffort(
	keys: readonly string[],
): Promise<void> {
	const unique = [...new Set(keys)];
	if (unique.length === 0) return;

	let index = 0;

	async function worker(): Promise<void> {
		while (index < unique.length) {
			const key = unique[index];
			index += 1;

			if (!key || key.includes("..") || key.includes("//")) continue;

			try {
				await deleteObject(key);
			} catch {
				// See the contract above: cleanup never fails the request.
			}
		}
	}

	const workers = Array.from(
		{ length: Math.min(DELETE_CONCURRENCY, unique.length) },
		() => worker(),
	);

	await Promise.race([Promise.all(workers), delay(CLEANUP_DEADLINE_MS)]);
}
