/**
 * Shared Redis connection options for BullMQ and Better Auth.
 * Derived from REDIS_URL / REDIS_PASSWORD env vars so dev and prod
 * stay consistent with the compose-provided Redis service.
 */
function parseRedisUrl(url: string): { host: string; port: number } {
	const parsed = new URL(url);
	return {
		host: parsed.hostname || "localhost",
		port: Number(parsed.port || 6379),
	};
}

const { host, port } = parseRedisUrl(
	process.env.REDIS_URL ?? "redis://localhost:6379",
);

export const redisConnectionOptions = {
	host,
	port,
	password: process.env.REDIS_PASSWORD || undefined,
};
