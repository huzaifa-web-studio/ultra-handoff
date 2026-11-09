import Redis from "ioredis";

import { isProduction, redisEnv } from "./env";
import { withDeadline } from "./timeout";

/**
 * Redis configuration for the API.
 *
 * Two connection shapes come out of this file, deliberately:
 *
 * 1. `redisConnectionOptions` is for BullMQ only. BullMQ issues blocking
 *    commands and owns its own reconnection, so it needs the offline queue and
 *    the per request retry budget left at their defaults. Tightening them here
 *    would abort the blocking reads a worker depends on.
 * 2. `redisClientOptions` is for our own client. That client backs Better Auth
 *    session reads, upload sessions, rate limits and realtime publishing. It
 *    must fail fast, because a command that waits while ioredis reconnects is
 *    exactly what turned a Redis outage into a 30 second authenticated request
 *    hang.
 *
 * Used by: src/auth/secondary-storage.ts, src/lib/storage/session.ts,
 * src/lib/rate-limit.ts, src/realtime/bus.ts and every queue in
 * src/queues/.
 */

export type RedisUrlParts = {
	host: string;
	port: number;
	username?: string;
	password?: string;
};

/**
 * Decode one URL component without letting a malformed escape crash the boot.
 *
 * `URL` keeps percent encoding, while ioredis expects the literal value. A
 * generated provider password is usually encoded (for example `p%40ss`), so it
 * has to be decoded before it is used for AUTH.
 */
function decodePart(value: string): string | undefined {
	if (!value) return undefined;

	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * Read the connection parts out of a `redis://` URL.
 *
 * Credentials are read here rather than only from `REDIS_PASSWORD`, because a
 * managed provider hands out one URL. Ignoring the URL userinfo made a
 * `redis://:secret@host:6379` connection go out unauthenticated and fail later
 * as NOAUTH, far from the cause.
 */
export function parseRedisUrl(url: string): RedisUrlParts {
	const parsed = new URL(url);

	return {
		host: parsed.hostname || "localhost",
		port: Number(parsed.port || 6379),
		username: decodePart(parsed.username),
		password: decodePart(parsed.password),
	};
}

/**
 * Resolve the credentials actually sent to Redis.
 *
 * Precedence: an explicit `REDIS_PASSWORD` wins, then the password embedded in
 * the URL. The username has no environment variable of its own, so it always
 * comes from the URL.
 */
export function resolveRedisAuth(
	parts: RedisUrlParts,
	envPassword?: string,
): { username?: string; password?: string } {
	return {
		username: parts.username,
		password: envPassword || parts.password,
	};
}

const redisUrl = parseRedisUrl(redisEnv.url);

/** Connection options for BullMQ. Deliberately permissive, see the file header. */
export const redisConnectionOptions = {
	host: redisUrl.host,
	port: redisUrl.port,
	...resolveRedisAuth(redisUrl, redisEnv.password),
};

/** How long one application command may take before it is abandoned. */
export const REDIS_COMMAND_TIMEOUT_MS = 500;

/** How long a TCP connect may take before ioredis retries. */
const REDIS_CONNECT_TIMEOUT_MS = 1_000;

/**
 * How long an auth read waits before Better Auth falls back to Postgres.
 *
 * Kept under a second on purpose: the database copy of the session is a
 * complete answer, so waiting longer only adds latency to every request during
 * an outage.
 */
export const REDIS_READ_DEADLINE_MS = 250;

/** Minimum gap between two Redis outage log lines. */
const REDIS_LOG_INTERVAL_MS = 30_000;

/**
 * Connection options for our own client.
 *
 * `enableOfflineQueue: false` rejects a command immediately while the socket is
 * reconnecting instead of queuing it until Redis returns, and `commandTimeout`
 * bounds a command on a socket that looks open but is silent. Both are required
 * for the fallback in secondary-storage.ts to ever run.
 */
export const redisClientOptions = {
	...redisConnectionOptions,
	enableOfflineQueue: false,
	connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
	commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
	maxRetriesPerRequest: 1,
};

/** Last time each log key was printed, so one outage cannot flood the log. */
const lastLoggedAt = new Map<string, number>();

/**
 * Build the one line Redis outage message.
 *
 * Why: `console.error(message, error)` printed the whole ioredis stack, which
 * buried the useful line and filled the integration suite output. The error
 * message and the ioredis code are the two parts an operator actually needs.
 *
 * Kept pure and exported so the shape can be tested without opening a socket.
 */
export function formatRedisIssue(key: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const rawCode =
		error && typeof error === "object" && "code" in error
			? (error as { code?: unknown }).code
			: undefined;
	// `String(undefined)` is the truthy string "undefined", so guard first.
	const code = rawCode === undefined || rawCode === null ? "" : String(rawCode);

	return code
		? `[redis] ${key} failed (${code}): ${message}`
		: `[redis] ${key} failed: ${message}`;
}

/**
 * Log a Redis problem at most once per key per window.
 *
 * Why throttled: during an outage every request fails, and one log line per
 * failure buries the first useful line. Dev only, matching the rest of the API
 * until a real production logger exists.
 */
export function logRedisIssue(key: string, error: unknown): void {
	if (isProduction) return;

	const now = Date.now();
	const previous = lastLoggedAt.get(key) ?? 0;

	if (now - previous < REDIS_LOG_INTERVAL_MS) return;

	lastLoggedAt.set(key, now);
	console.error(formatRedisIssue(key, error));
}

/**
 * Lazily created client for short lived application state.
 *
 * Why not reuse a BullMQ connection: BullMQ owns and duplicates its own
 * connections, and closing those on shutdown must not close the client used
 * for upload sessions. This one is ours.
 *
 * Used by: src/lib/storage/session.ts, src/lib/rate-limit.ts,
 * src/auth/secondary-storage.ts and src/realtime/bus.ts.
 */
let redisClient: Redis | null = null;

export function getRedis(): Redis {
	if (!redisClient) {
		const client = new Redis(redisClientOptions);

		// ioredis is an EventEmitter. Without an error listener an emitted
		// error is unhandled and can take the process down, so one throttled
		// listener protects both the process and the log during an outage.
		client.on("error", (error) => logRedisIssue("connection", error));

		redisClient = client;
	}

	return redisClient;
}

/**
 * Round trip that proves the shared client can reach Redis right now.
 *
 * Used by: src/routes/health.ts. The readiness probe calls this instead of
 * trusting `/health`, which only proves the process is alive. It exercises the
 * same client and the same options as a session read, and a false result means
 * auth is running from the database fallback.
 */
export async function pingRedis(): Promise<boolean> {
	try {
		return await withDeadline(
			getRedis()
				.ping()
				.then((reply) => reply === "PONG"),
			REDIS_READ_DEADLINE_MS,
			() => false,
		);
	} catch (error) {
		logRedisIssue("ping", error);
		return false;
	}
}

/** Close the shared client during graceful shutdown. */
export async function closeRedis(): Promise<void> {
	const client = redisClient;
	redisClient = null;

	if (!client) return;

	// `quit` waits for pending replies, which can outlive a deploy when Redis
	// is unreachable. Bound it, then drop the socket outright so shutdown
	// never hangs on the cache.
	await withDeadline(client.quit(), 1_000, () => {
		client.disconnect();
		return "OK";
	}).catch(() => {
		client.disconnect();
	});
}
