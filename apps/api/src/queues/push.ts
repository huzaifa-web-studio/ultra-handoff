/**
 * Web Push delivery queue.
 *
 * Why a queue: a notification write must not wait on a third party push
 * service, and a push endpoint that is briefly down should be retried without
 * delaying the in-app bell. The job carries the already rendered title, body
 * and href, so the worker never reads another person's notification row.
 *
 * Used by: services/notification-dispatch.service.ts and src/workers/index.ts.
 */

import { type Job, Worker } from "bullmq";

import { isProduction, pushEnabled } from "../lib/env";
import { redisConnectionOptions } from "../lib/redis";
import { type PushPayload, sendPushToUser } from "../services/push.service";
import { createQueue, logQueueErrors } from "./index";

export const PUSH_QUEUE_NAME = "push";

/** Registered here so Bull Board in development lists the queue. */
export const pushQueue = createQueue(PUSH_QUEUE_NAME);

/** One rendered push for one person. */
export type PushJobData = {
	userId: string;
	payload: PushPayload;
};

/** Queue one push. Best effort: a queue outage must not fail the save. */
export async function enqueuePush(data: PushJobData): Promise<void> {
	// A deployment without VAPID keys does not need a queue of jobs that can
	// only return early.
	if (!pushEnabled) return;

	await pushQueue.add("send", data, {
		attempts: 3,
		backoff: { type: "exponential", delay: 5_000 },
		removeOnComplete: { age: 60 * 60, count: 1_000 },
		removeOnFail: { age: 24 * 60 * 60 },
	});
}

let worker: Worker<PushJobData> | null = null;

/** Start the in-process worker. Repeated calls reuse the instance. */
export function startPushWorker(): void {
	if (worker) return;

	worker = new Worker<PushJobData>(
		PUSH_QUEUE_NAME,
		async (job: Job<PushJobData>) => {
			await sendPushToUser(job.data.userId, job.data.payload);
		},
		{ connection: redisConnectionOptions, concurrency: 5 },
	);
	logQueueErrors(worker, PUSH_QUEUE_NAME);

	worker.on("failed", (_job, error) => {
		if (!isProduction) {
			console.error("[push] delivery failed:", error);
		}
	});
}

/** Close the worker and the queue on shutdown. */
export async function stopPushWorker(): Promise<void> {
	await worker?.close();
	worker = null;
	await pushQueue.close();
}
