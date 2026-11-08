/**
 * Redis backed secondary storage for Better Auth.
 *
 * Why: sessions, verification tokens and rate limit counters are short lived
 * and read on almost every request. Keeping them in Redis removes the hottest
 * reads from Postgres, while `storeSessionInDatabase` keeps a durable copy.
 *
 * Failure policy: Redis must not take authentication down. Reads return null
 * so Better Auth falls back to the database copy, writes become no-ops and
 * rate limit counters fail open. The API stays usable during a Redis restart.
 *
 * The deadline in `failSoft` is what actually delivers that promise. Catching a
 * rejection is not enough, because ioredis can leave a command pending for the
 * whole reconnect window, and until it settles Better Auth never reaches the
 * database copy.
 *
 * Used by: src/auth/auth.ts.
 */

import { getRedis, logRedisIssue, REDIS_READ_DEADLINE_MS } from "../lib/redis";
import { withDeadline } from "../lib/timeout";

/** Namespace so auth keys cannot collide with upload keys in the same Redis. */
const KEY_PREFIX = "auth:";

/**
 * Structural copy of Better Auth's SecondaryStorage interface.
 *
 * Better Auth 1.7 does not re-export the type from its public entrypoint, so
 * the shape is declared here and checked against the option at the call site.
 */
type AuthSecondaryStorage = {
	get: (key: string) => Promise<unknown>;
	getAndDelete: (key: string) => Promise<unknown>;
	increment: (key: string, ttl: number) => Promise<number>;
	set: (key: string, value: string, ttl?: number) => Promise<void>;
	delete: (key: string) => Promise<void>;
};

function redisKey(key: string): string {
	return `${KEY_PREFIX}${key}`;
}

/**
 * Run one Redis operation and degrade gracefully when it fails or stalls.
 *
 * The deadline matters as much as the catch: a command stuck on a reconnecting
 * socket never rejects, so without it the fallback would never be returned and
 * the request would wait out ioredis. Dev only logging, throttled so a long
 * outage cannot flood the log.
 */
async function failSoft<T>(
	operation: string,
	fallback: T,
	run: () => Promise<T>,
): Promise<T> {
	try {
		return await withDeadline(run(), REDIS_READ_DEADLINE_MS, () => fallback);
	} catch (error) {
		logRedisIssue(`auth ${operation}`, error);

		return fallback;
	}
}

export const authSecondaryStorage: AuthSecondaryStorage = {
	get(key) {
		return failSoft("get", null, () => getRedis().get(redisKey(key)));
	},

	/**
	 * Used when a token must be consumed exactly once. GETDEL is atomic, so two
	 * concurrent requests cannot both redeem the same token.
	 */
	getAndDelete(key) {
		return failSoft("getAndDelete", null, () =>
			getRedis().getdel(redisKey(key)),
		);
	},

	/**
	 * Atomic counter for rate limiting. The expiry is set only on creation so
	 * later increments keep a fixed window instead of extending it.
	 */
	increment(key, ttl) {
		return failSoft("increment", 0, async () => {
			const redis = getRedis();
			const counterKey = redisKey(key);
			const count = await redis.incr(counterKey);

			if (count === 1 && ttl > 0) {
				await redis.expire(counterKey, ttl);
			}

			return count;
		});
	},

	set(key, value, ttl) {
		return failSoft("set", undefined, async () => {
			if (ttl && ttl > 0) {
				await getRedis().set(redisKey(key), value, "EX", ttl);
				return;
			}

			await getRedis().set(redisKey(key), value);
		});
	},

	delete(key) {
		return failSoft("delete", undefined, async () => {
			await getRedis().del(redisKey(key));
		});
	},
};
