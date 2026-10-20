import Redis from "ioredis";

import { redisEnv } from "./env";

/**
 * Shared Redis connection options for BullMQ and Better Auth.
 * Derived from the centralised Redis config so dev and prod stay consistent
 * with the compose-provided Redis service.
 */
function parseRedisUrl(url: string): { host: string; port: number } {
	const parsed = new URL(url);
	return {
		host: parsed.hostname || "localhost",
		port: Number(parsed.port || 6379),
	};
}

const { host, port } = parseRedisUrl(redisEnv.url);

export const redisConnectionOptions = {
	host,
	port,
	password: redisEnv.password,
};

/**
 * Lazily created client for short lived application state.
 *
 * Why not reuse a BullMQ connection: BullMQ owns and duplicates its own
 * connections, and closing those on shutdown must not close the client used
 * for upload sessions. This one is ours.
 *
 * Used by: src/lib/storage/session.ts.
 */
let redisClient: Redis | null = null;

export function getRedis(): Redis {
	if (!redisClient) {
		redisClient = new Redis(redisConnectionOptions);
	}

	return redisClient;
}

/** Close the shared client during graceful shutdown. */
export async function closeRedis(): Promise<void> {
	if (redisClient) {
		await redisClient.quit();
		redisClient = null;
	}
}
