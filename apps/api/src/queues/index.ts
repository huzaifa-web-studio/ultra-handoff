import { Queue } from "bullmq";

import { logRedisIssue, redisConnectionOptions } from "../lib/redis";

/**
 * Registry of BullMQ queues exposed to Bull Board.
 * Every queue module calls `createQueue` at import time, so the dashboard
 * lists all of them without an extra registration step.
 * Production never mounts Bull Board anyway.
 */
export const queues: Queue[] = [];

/**
 * Attach the shared throttled logger to a BullMQ emitter.
 *
 * Why: BullMQ re-emits every connection error on the queue, worker or queue
 * events object. With no listener its own emitter falls back to a plain
 * `console.error` per retry, so a single Redis outage produced dozens of
 * identical DNS lines in seconds. One throttled listener per emitter keeps the
 * first line and drops the repeats.
 *
 * Typed structurally so `Queue`, `Worker` and `QueueEvents` all match.
 */
export function logQueueErrors(
	emitter: {
		on: (event: "error", listener: (error: unknown) => void) => unknown;
	},
	label: string,
): void {
	emitter.on("error", (error) => logRedisIssue(`queue ${label}`, error));
}

/**
 * Helper to create a queue that shares the app's Redis connection.
 * Kept here so all queues stay consistent with the configured Redis.
 */
export function createQueue(name: string): Queue {
	const queue = new Queue(name, { connection: redisConnectionOptions });
	logQueueErrors(queue, name);
	queues.push(queue);
	return queue;
}
