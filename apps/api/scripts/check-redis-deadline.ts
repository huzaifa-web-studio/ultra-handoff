/**
 * Prove that a stalled Redis cannot hold an auth request open.
 *
 * Why this script: the phase 3 report showed a 29.7 second hang while
 * `/health` stayed green. That is hard to reproduce with a stop, because a
 * stopped Redis refuses the connection and fails fast for the wrong reason.
 * The real failure was a connected but silent server, which ioredis happily
 * queues against.
 *
 * How: a TCP proxy sits in front of the configured Redis. Once the client
 * reaches the ready state the proxy stops forwarding client traffic while both
 * sockets stay open. Every auth call must then return its fallback in under a
 * second, which is the deadline added in Batch 3.
 *
 * Usage: `bun run check:redis` from apps/api, with Redis reachable at
 * REDIS_UPSTREAM_URL (default redis://127.0.0.1:6379).
 */

import net from "node:net";

/** A call slower than this is a failed check, not a slow one. */
const MAX_ACCEPTABLE_MS = 1_000;
const LISTEN_PORT = Number(Bun.env.REDIS_CHECK_PORT ?? 6399);
const UPSTREAM_URL = Bun.env.REDIS_UPSTREAM_URL ?? "redis://127.0.0.1:6379";

// Point the app at the proxy before importing anything that reads the env.
// `src/lib/redis.ts` resolves its connection options at module load.
process.env.REDIS_URL = `redis://127.0.0.1:${LISTEN_PORT}`;

const { parseRedisUrl } = await import("../src/lib/redis");
const upstream = parseRedisUrl(UPSTREAM_URL);

let silent = false;

/** Forward bytes until the benchmark decides the server should go quiet. */
const proxy = net.createServer((client) => {
	const server = net.connect(upstream.port, upstream.host);

	client.on("data", (chunk) => {
		if (silent) return;
		server.write(chunk);
	});
	server.on("data", (chunk) => client.write(chunk));
	client.on("error", () => server.destroy());
	server.on("error", () => client.destroy());
	client.on("close", () => server.destroy());
	server.on("close", () => client.destroy());
});

await new Promise<void>((resolve) =>
	proxy.listen(LISTEN_PORT, "127.0.0.1", resolve),
);

const { authSecondaryStorage } = await import("../src/auth/secondary-storage");
const { closeRedis, getRedis, pingRedis } = await import("../src/lib/redis");

let ready = false;
for (let attempt = 0; attempt < 500; attempt += 1) {
	if (getRedis().status === "ready") {
		ready = true;
		break;
	}
	await Bun.sleep(10);
}

if (!ready) {
	console.error(
		`Redis did not reach the ready state. Is it running at ${upstream.host}:${upstream.port}?`,
	);
	process.exit(1);
}

console.info("Proxy is ready. Cutting replies while keeping the socket open.");

silent = true;

let failed = false;

/** Run one call and require the fallback inside the deadline. */
async function check<T>(
	label: string,
	run: () => Promise<T>,
	expected: T,
): Promise<void> {
	const started = performance.now();
	const value = await run();
	const elapsed = Math.round(performance.now() - started);

	const valueOk = value === expected;
	const timeOk = elapsed < MAX_ACCEPTABLE_MS;

	console.info(
		`${label}: ${JSON.stringify(value)} in ${elapsed} ms (limit ${MAX_ACCEPTABLE_MS} ms)`,
	);

	if (!valueOk || !timeOk) {
		failed = true;
		console.error(
			`  FAILED: expected ${JSON.stringify(expected)} within the limit`,
		);
	}
}

await check("auth read", () => authSecondaryStorage.get("deadline-check"), null);
await check(
	"auth increment",
	() => authSecondaryStorage.increment("deadline-check", 60),
	0,
);
await check(
	"auth write",
	() => authSecondaryStorage.set("deadline-check", "1", 60),
	undefined,
);
await check("readiness ping", () => pingRedis(), false);

await closeRedis();
proxy.close();

if (failed) {
	process.exit(1);
}

console.info("Redis deadline check passed.");
process.exit(0);
