import { Queue } from "bullmq";

import { redisConnectionOptions } from "../lib/redis";

/**
 * Registry of BullMQ queues exposed to Bull Board.
 * Add new queues here so they show up in the dev dashboard.
 * Empty by default; production never mounts Bull Board anyway.
 */
export const queues: Queue[] = [];

/**
 * Helper to create a queue that shares the app's Redis connection.
 * Kept here so all queues stay consistent with the configured Redis.
 */
export function createQueue(name: string): Queue {
	const queue = new Queue(name, { connection: redisConnectionOptions });
	queues.push(queue);
	return queue;
}
