/**
 * Liveness and readiness routes.
 *
 * Why two endpoints: `/health` answers "is this process alive" and is what the
 * container healthcheck calls. `/ready` answers "can this process serve an
 * authenticated request right now", which is a different question. The phase 3
 * report found `/health` returning 200 while every logged-in request hung for
 * 30 seconds, because the probe never touched Redis at all.
 *
 * Redis is reported as a degraded dependency, not a failed one: Better Auth
 * keeps a database copy of every session, so an outage slows auth down but does
 * not stop it. Postgres is the floor. Without it nothing authenticated works,
 * so only a database failure returns 503.
 *
 * Used by: src/index.ts. Exposes no session or tenant data.
 */

import { sql } from "drizzle-orm";
import { Elysia } from "elysia";

import { adminDb } from "../db";
import { pingRedis } from "../lib/redis";
import { TimeoutError, withDeadline } from "../lib/timeout";

/** How long readiness waits on Postgres before calling it down. */
const READINESS_DB_DEADLINE_MS = 1_000;

type DependencyState = "ok" | "down";

/**
 * Prove the privileged pool can execute a trivial query.
 *
 * `adminDb` is the Better Auth adapter's connection, so this exercises the same
 * pool a session lookup uses. A query that never answers is reported down after
 * the deadline instead of holding the probe open.
 */
async function checkDatabase(): Promise<DependencyState> {
	try {
		await withDeadline(
			adminDb.execute(sql`select 1`),
			READINESS_DB_DEADLINE_MS,
			() => {
				throw new TimeoutError("Database readiness check timed out");
			},
		);

		return "ok";
	} catch {
		return "down";
	}
}

/**
 * Prove the shared Redis client can reach the server.
 *
 * This is the same client and the same connection options Better Auth uses for
 * a session read, so a healthy result says the fast path is actually working.
 * A probe cannot present a real session cookie, so it checks the path rather
 * than one particular session row.
 */
async function checkRedis(): Promise<DependencyState> {
	return (await pingRedis()) ? "ok" : "down";
}

export const healthRoutes = new Elysia()
	/** Liveness only. Unchanged contract for the Dockerfile healthcheck. */
	.get("/health", () => ({ status: "ok" }))
	/**
	 * Readiness. 200 means authenticated traffic can be served, with Redis
	 * called out as degraded when it is running from the Postgres fallback.
	 * 503 is reserved for a database failure.
	 */
	.get("/ready", async ({ status }) => {
		const [database, redis] = await Promise.all([
			checkDatabase(),
			checkRedis(),
		]);

		const checks = { database, redis };

		if (database === "down") {
			return status(503, { status: "down", checks });
		}

		return { status: redis === "ok" ? "ok" : "degraded", checks };
	});
