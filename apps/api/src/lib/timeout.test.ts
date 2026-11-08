/**
 * Tests for the shared deadline helper.
 *
 * Why: every resilience fix in Batch 3 depends on this function settling in
 * bounded time, including the case where the underlying operation never
 * settles at all. A regression here would silently restore the Redis hang.
 */

import { describe, expect, it } from "bun:test";

import { TimeoutError, withDeadline } from "./timeout";

/** A promise that never settles, standing in for a stalled socket. */
function never<T>(): Promise<T> {
	return new Promise<T>(() => undefined);
}

describe("withDeadline", () => {
	it("resolves the operation value when it settles first", async () => {
		const value = await withDeadline(Promise.resolve("done"), 50, () => "late");

		expect(value).toBe("done");
	});

	it("returns the fallback when the operation never settles", async () => {
		const value = await withDeadline(never<string>(), 5, () => "fallback");

		expect(value).toBe("fallback");
	});

	it("can turn a deadline into a TimeoutError rejection", async () => {
		await expect(
			withDeadline(never<string>(), 5, () => {
				throw new TimeoutError("too slow");
			}),
		).rejects.toBeInstanceOf(TimeoutError);
	});

	it("propagates an operation failure before the deadline", async () => {
		await expect(
			withDeadline(Promise.reject(new Error("boom")), 50, () => "fallback"),
		).rejects.toThrow("boom");
	});

	it("ignores an operation failure that arrives after the deadline", async () => {
		let rejectLate: (error: Error) => void = () => undefined;
		const operation = new Promise<string>((_resolve, reject) => {
			rejectLate = reject;
		});

		const value = await withDeadline(operation, 5, () => "fallback");
		expect(value).toBe("fallback");

		// The late rejection must be handled by the deadline helper itself.
		rejectLate(new Error("late"));
		await Promise.resolve();
	});
});
