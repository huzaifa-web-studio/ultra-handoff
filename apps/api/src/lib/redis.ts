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
