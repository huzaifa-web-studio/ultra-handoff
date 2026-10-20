/**
 * Transactional email queue and worker.
 *
 * Why a worker: Better Auth asks for a verification, reset or deletion email
 * inside its own request handlers. Sending over SMTP there would make sign up
 * and account deletion wait on a third party and would lose the message when
 * SMTP is briefly down. A queue makes the request fast and gives delivery
 * retries with backoff.
 *
 * Used by: src/auth/auth.ts (enqueue), src/workers/index.ts (start and stop),
 * and Bull Board in development.
 */

import { type Job, Worker } from "bullmq";

import { isProduction } from "../lib/env";
import { deliverEmail, type EmailJobData } from "../lib/mailer";
import { redisConnectionOptions } from "../lib/redis";
import { createQueue } from "./index";

export const EMAIL_QUEUE_NAME = "email";

/** Registered here so Bull Board in development lists the queue. */
export const emailQueue = createQueue(EMAIL_QUEUE_NAME);

/** Delivery attempts before a message is left for inspection. */
const EMAIL_ATTEMPTS = 5;

/** First retry delay. Exponential backoff grows it from here. */
const EMAIL_BACKOFF_MS = 5_000;

/** Delivered mail is transient, failures stay long enough to be investigated. */
const COMPLETED_RETENTION_SECONDS = 60 * 60;
const FAILED_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/**
 * Queue one email.
 *
 * There is deliberately no job id. A job id would deduplicate repeated
 * requests, and a user asking for the verification email a second time is a
 * legitimate new job.
 */
export async function enqueueEmail(job: EmailJobData): Promise<void> {
	await emailQueue.add("send", job, {
		attempts: EMAIL_ATTEMPTS,
		backoff: { type: "exponential", delay: EMAIL_BACKOFF_MS },
		removeOnComplete: {
			age: COMPLETED_RETENTION_SECONDS,
			count: 1000,
		},
		removeOnFail: { age: FAILED_RETENTION_SECONDS },
	});
}

let worker: Worker<EmailJobData> | null = null;

/** Start the in-process worker. Repeated calls reuse the same instance. */
export function startEmailWorker(): void {
	if (worker) return;

	worker = new Worker<EmailJobData>(
		EMAIL_QUEUE_NAME,
		async (job: Job<EmailJobData>) => {
			await deliverEmail(job.data);
		},
		{
			connection: redisConnectionOptions,
			concurrency: 5,
		},
	);

	worker.on("failed", (job, error) => {
		if (!job) return;

		// Earlier failures are retried. Only the final attempt is a real loss.
		const attempts = job.opts.attempts ?? 1;
		if (job.attemptsMade < attempts) return;

		if (!isProduction) {
			console.error(
				"[email] delivery failed after",
				job.attemptsMade,
				"attempts:",
				job.data.template,
				error,
			);
		}
	});
}

/** Close the worker and the queue on shutdown. */
export async function stopEmailWorker(): Promise<void> {
	await worker?.close();
	worker = null;
	await emailQueue.close();
}
