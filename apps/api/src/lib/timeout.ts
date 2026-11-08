/**
 * Bounded waits for infrastructure calls.
 *
 * Why this exists: a dependency that accepts a connection and then never
 * answers must not hold an HTTP request or a worker slot open. A bare
 * `Promise.race` is not enough on its own, because the losing promise can
 * reject after the deadline and become an unhandled rejection. This helper
 * keeps a handler attached to the operation for its whole lifetime, so the
 * deadline is safe to use around ioredis commands, S3 calls and database
 * queries alike.
 *
 * Used by: src/lib/redis.ts, src/auth/secondary-storage.ts,
 * src/lib/storage/client.ts, src/queues/upload-verification.ts and
 * src/routes/health.ts.
 */

/** Raised when an operation did not settle before its deadline. */
export class TimeoutError extends Error {
	constructor(message = "Operation timed out") {
		super(message);
		this.name = "TimeoutError";
	}
}

/**
 * Resolve or reject from `operation`, but never wait longer than `ms`.
 *
 * `onTimeout` produces the value used when the deadline wins. It may throw to
 * turn a timeout into a rejection, which is how storage and worker calls turn
 * a hung socket into a real, retryable error instead of a silent fallback.
 *
 * The handlers passed to `operation.then` stay attached even after the
 * deadline has settled this promise, so a late rejection is already handled
 * and never surfaces as an unhandled rejection.
 */
export function withDeadline<T>(
	operation: Promise<T>,
	ms: number,
	onTimeout: () => T,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) return;

			settled = true;

			try {
				resolve(onTimeout());
			} catch (error) {
				reject(error);
			}
		}, ms);

		operation.then(
			(value) => {
				if (settled) return;

				settled = true;
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				if (settled) return;

				settled = true;
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
