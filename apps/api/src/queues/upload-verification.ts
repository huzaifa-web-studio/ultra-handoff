/**
 * Upload verification queue and worker.
 *
 * Why a worker: the browser uploads straight to SeaweedFS, so the API only
 * sees a declaration of what was uploaded. A background job confirms the
 * object exists, has the expected size, and really is a PNG or JPEG. Doing
 * that inline would make the upload request wait on storage round trips and
 * would lose retries.
 *
 * Used by: src/index.ts (start and stop), src/routes/uploads.ts (enqueue and
 * wait), and Bull Board in development.
 */

import { type Job, QueueEvents, Worker } from "bullmq";
import { redisConnectionOptions } from "../lib/redis";
import {
	deleteObject,
	getUploadSession,
	headObject,
	isNotFoundError,
	readHeadBytes,
	sniffImageType,
	UPLOAD_POLICIES,
	type UploadSession,
} from "../lib/storage";
import {
	markUploadRejected,
	markUploadVerified,
	markUploadVerifying,
} from "../services/upload.service";
import { createQueue } from "./index";

export const UPLOAD_QUEUE_NAME = "upload-verification";

type VerificationJob = { uploadId: string };

type VerificationResult =
	| { status: "verified"; url?: string }
	| { status: "rejected"; reason: string }
	| { status: "missing" };

/** Registered here so Bull Board in development lists the queue. */
export const uploadQueue = createQueue(UPLOAD_QUEUE_NAME);

/**
 * QueueEvents is what lets the upload route wait for a result instead of
 * making the browser poll on every healthy upload. It is a separate Redis
 * connection, which BullMQ requires.
 */
const queueEvents = new QueueEvents(UPLOAD_QUEUE_NAME, {
	connection: redisConnectionOptions,
});

/** Reject and remember why, so the route and the UI can explain it. */
async function reject(
	session: UploadSession,
	reason: string,
): Promise<VerificationResult> {
	await markUploadRejected(session.id, reason);
	return { status: "rejected", reason };
}

/**
 * Verify one uploaded object.
 *
 * Validation order is deliberate: cheap metadata first, ranged byte read
 * last. Anything that fails after the object exists is deleted, so a rejected
 * upload leaves nothing behind.
 */
async function verifyUpload(
	job: Job<VerificationJob>,
): Promise<VerificationResult> {
	const session = await getUploadSession(job.data.uploadId);
	if (!session) return { status: "missing" };

	// A retried job or a repeated complete request should not re-verify work.
	if (session.status === "verified") {
		return { status: "verified", url: session.url };
	}
	if (session.status === "rejected") {
		return {
			status: "rejected",
			reason: session.reason ?? "The upload was rejected",
		};
	}

	await markUploadVerifying(session.id);
	const policy = UPLOAD_POLICIES[session.purpose];

	try {
		const head = await headObject(session.key);
		const size = head.ContentLength ?? 0;
		const contentType = (head.ContentType ?? "")
			.split(";")[0]
			?.trim()
			.toLowerCase();

		if (size <= 0) {
			return reject(session, "The uploaded file is empty");
		}

		if (size > policy.maxBytes) {
			await deleteObject(session.key);
			return reject(session, "The file is larger than the allowed size");
		}

		if (!contentType || !policy.allowedMime.includes(contentType)) {
			await deleteObject(session.key);
			return reject(session, "This file type is not allowed");
		}

		// The browser must send the Content-Type that was signed into the URL.
		// A mismatch means the object metadata was tampered with.
		if (contentType !== session.contentType) {
			await deleteObject(session.key);
			return reject(
				session,
				"The stored file type does not match the upload request",
			);
		}

		const header = await readHeadBytes(session.key, 16);
		const detected = sniffImageType(header);

		if (!detected || detected !== session.contentType) {
			await deleteObject(session.key);
			return reject(
				session,
				"The file content is not a valid PNG or JPG image",
			);
		}

		const updated = await markUploadVerified(session.id);
		return { status: "verified", url: updated?.url };
	} catch (error) {
		// A missing object is a user error, not a transient storage failure.
		if (isNotFoundError(error)) {
			return reject(session, "The uploaded file could not be found");
		}

		// Anything else is retryable. Rethrow so BullMQ applies the backoff.
		throw error;
	}
}

/** Create the verification job. Job id deduplicates repeated complete calls. */
export async function enqueueUploadVerification(
	uploadId: string,
): Promise<void> {
	await uploadQueue.add(
		"verify",
		{ uploadId },
		{
			jobId: uploadId,
			attempts: 3,
			backoff: { type: "exponential", delay: 1000 },
			removeOnComplete: { age: 60 * 60 },
			removeOnFail: { age: 24 * 60 * 60 },
		},
	);
}

/**
 * Wait briefly for a result.
 *
 * The caller still reads the Redis session afterwards. A timeout is not an
 * error: it simply means the browser should poll, and the job keeps running.
 */
export async function waitForUploadVerification(
	uploadId: string,
	timeoutMs = 8000,
): Promise<void> {
	const job = await uploadQueue.getJob(uploadId);
	if (!job) return;

	try {
		await job.waitUntilFinished(queueEvents, timeoutMs);
	} catch {
		// Timeout or a failed attempt. The route inspects the session.
	}
}

let worker: Worker<VerificationJob, VerificationResult> | null = null;

/** Start the in-process worker. Repeated calls reuse the same instance. */
export function startUploadVerificationWorker(): void {
	if (worker) return;

	worker = new Worker<VerificationJob, VerificationResult>(
		UPLOAD_QUEUE_NAME,
		verifyUpload,
		{
			connection: redisConnectionOptions,
			concurrency: 5,
		},
	);

	worker.on("failed", (job, _error) => {
		if (!job) return;

		// Only give up after the final attempt. Earlier failures are retried
		// with the exponential backoff configured above.
		const attempts = job.opts.attempts ?? 1;
		if (job.attemptsMade < attempts) return;

		// Event handlers cannot surface a rejected promise, so the state write
		// is explicitly fire and forget.
		void markUploadRejected(
			job.data.uploadId,
			"We could not verify the upload. Please try again.",
		).catch(() => undefined);
	});
}

/** Close the worker, the events connection and the queue on shutdown. */
export async function stopUploadVerification(): Promise<void> {
	await worker?.close();
	worker = null;
	await queueEvents.close();
	await uploadQueue.close();
}
