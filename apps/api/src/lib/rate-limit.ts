import { isProduction } from "./env";
import { getRedis } from "./redis";

/**
 * Redis backed throttles for actions that send email.
 *
 * Why: Better Auth rate limits its own endpoints, but our bulk invite and
 * magic-link routes call the library from the server. Without a second guard,
 * one manager could queue hundreds of messages, or anyone holding an invitation
 * link could email-bomb the invitee.
 *
 * Every helper fails open. A Redis outage must not stop people from inviting
 * teammates, and Better Auth's own limiter still applies.
 *
 * Used by: src/services/invitation.service.ts.
 */

/**
 * Count an action against a fixed window.
 *
 * Returns false when the limit is already used. The first hit in a window sets
 * the expiry, so a burst cannot extend the window indefinitely.
 */
export async function consumeRateLimit(
	key: string,
	limit: number,
	windowSeconds: number,
): Promise<boolean> {
	try {
		const redis = getRedis();
		const count = await redis.incr(key);

		if (count === 1) {
			await redis.expire(key, windowSeconds);
		}

		return count <= limit;
	} catch (error) {
		if (!isProduction) {
			console.error("[rate-limit] check failed, allowing request:", error);
		}

		return true;
	}
}

/**
 * One-shot cooldown for a single resource.
 *
 * Returns true the first time within the window and false afterwards. Used for
 * "send me another magic link", where a per resource cooldown is friendlier
 * than a global counter.
 */
export async function startCooldown(
	key: string,
	seconds: number,
): Promise<boolean> {
	try {
		const redis = getRedis();
		const result = await redis.set(key, "1", "EX", seconds, "NX");

		return result === "OK";
	} catch (error) {
		if (!isProduction) {
			console.error("[rate-limit] cooldown failed, allowing request:", error);
		}

		return true;
	}
}
