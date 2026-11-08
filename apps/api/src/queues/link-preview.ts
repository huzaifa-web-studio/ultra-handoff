/**
 * Link preview queue and worker.
 *
 * Why a queue: preview resolution makes outbound HTTP calls that can take
 * seconds. Doing that on the save request would make autosave wait on somebody
 * else's website, and doing it on hover would turn the API into an on-demand
 * fetcher. A background job is the only shape that is both fast and safe.
 *
 * The job carries the tenant scope because row level security needs an
 * organization. The user id comes from the request that enqueued the job, so
 * the same `withTenant` boundary applies as everywhere else.
 *
 * Used by: src/workers/index.ts and src/services/link-preview.service.ts.
 */

import { type Job, Worker } from "bullmq";
import { resolvePreview } from "../lib/link-preview/resolve";
import {
	canonicalizeUrl,
	hashUrl,
	parsePreviewUrl,
} from "../lib/link-preview/url";
import { redisConnectionOptions } from "../lib/redis";
import { storeResolvedPreview } from "../services/link-preview.service";
import { createQueue, logQueueErrors } from "./index";

export const LINK_PREVIEW_QUEUE_NAME = "link-preview";

/** One URL to resolve for one workspace. */
export type LinkPreviewJob = {
	organizationId: string;
	userId: string;
	url: string;
};

/** Registered here so Bull Board in development lists the queue. */
export const linkPreviewQueue = createQueue(LINK_PREVIEW_QUEUE_NAME);

/** Stable job id, so a repeated save cannot queue the same URL twice. */
function jobIdFor(job: LinkPreviewJob): string | null {
	const parsed = parsePreviewUrl(job.url);

	if (!parsed) return null;

	// BullMQ rejects a custom job id containing `:` unless it has exactly three
	// segments, so the separator is an underscore. Both parts are alphanumeric,
	// which makes the id unambiguous.
	return `${job.organizationId}_${hashUrl(canonicalizeUrl(parsed))}`;
}

/**
 * Queue one URL.
 *
 * `removeOnComplete` is short because the database row is the real cache. The
 * job exists only to deduplicate work that is in flight.
 */
export async function enqueueLinkPreview(job: LinkPreviewJob): Promise<void> {
	const jobId = jobIdFor(job);

	if (!jobId) return;

	await linkPreviewQueue.add("resolve", job, {
		jobId,
		attempts: 2,
		backoff: { type: "exponential", delay: 2_000 },
		removeOnComplete: { age: 60 * 60 },
		removeOnFail: { age: 24 * 60 * 60 },
	});
}

/**
 * Hard ceiling for one job.
 *
 * Each network call already has its own deadline. This is the backstop that
 * guarantees a worker slot is released even if something unforeseen blocks:
 * a resolver, a socket or the object store. A rejected job is retried, and the
 * final failure is recorded as an unavailable preview.
 */
const JOB_TIMEOUT_MS = 45_000;

/** Bound a promise without relying on the operation to support cancellation. */
function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Link preview job timed out")),
			ms,
		);

		operation.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

/** Resolve one job. Network failures are retried by BullMQ. */
async function processJob(job: Job<LinkPreviewJob>): Promise<void> {
	const { organizationId, userId, url } = job.data;
	const tenant = { organizationId, userId };

	const outcome = await withTimeout(resolvePreview(url), JOB_TIMEOUT_MS);

	// A timeout or a network error is worth one retry. Every other outcome is
	// final, and storing it stops the URL from being fetched again.
	if (
		!outcome.ok &&
		(outcome.code === "timeout" || outcome.code === "network")
	) {
		const attempts = job.opts.attempts ?? 1;

		if (job.attemptsMade + 1 < attempts) {
			throw new Error("Transient link preview failure");
		}
	}

	await storeResolvedPreview(tenant, outcome);
}

let worker: Worker<LinkPreviewJob> | null = null;

/** Start the in-process worker. Repeated calls reuse the instance. */
export function startLinkPreviewWorker(): void {
	if (worker) return;

	worker = new Worker<LinkPreviewJob>(LINK_PREVIEW_QUEUE_NAME, processJob, {
		connection: redisConnectionOptions,
		// Outbound fetches are the slow part, so a small parallel window is
		// enough and keeps a burst from looking like a scan.
		concurrency: 3,
	});
	logQueueErrors(worker, LINK_PREVIEW_QUEUE_NAME);

	worker.on("failed", (job, error) => {
		if (!job) return;

		const attempts = job.opts.attempts ?? 1;
		if (job.attemptsMade < attempts) return;

		// Final attempt failed. Record it so the UI stops expecting a card and
		// the URL is not retried on every later save.
		void storeResolvedPreview(
			{
				organizationId: job.data.organizationId,
				userId: job.data.userId,
			},
			{
				ok: false,
				canonical: job.data.url,
				urlHash: hashUrl(job.data.url),
				code: "network",
			},
		).catch(() => undefined);

		// The error itself is only useful in development logs.
		if (process.env.NODE_ENV !== "production") {
			console.error("[link-preview] job failed", error.message);
		}
	});
}

/** Close the worker and the queue on shutdown. */
export async function stopLinkPreviewWorker(): Promise<void> {
	await worker?.close();
	worker = null;
	await linkPreviewQueue.close();
}
