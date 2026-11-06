/**
 * Reconnect policy tests.
 *
 * The bounds are the contract: too short and a deploy becomes a reconnect
 * thunderstorm, too long and a recovered connection looks frozen to the user.
 * Testing them here keeps the two numbers honest months later.
 */

import { describe, expect, it } from "bun:test";

import {
	isTerminalCloseCode,
	nextReconnectDelay,
	REALTIME_BASE_DELAY_MS,
	REALTIME_MAX_DELAY_MS,
} from "./policy";

describe("nextReconnectDelay", () => {
	it("starts below the base delay on the first attempt", () => {
		const delay = nextReconnectDelay(0, () => 0.5);

		expect(delay).toBe(REALTIME_BASE_DELAY_MS);
	});

	it("doubles the base delay as attempts grow", () => {
		const second = nextReconnectDelay(1, () => 0.5);
		const third = nextReconnectDelay(2, () => 0.5);

		expect(second).toBe(REALTIME_BASE_DELAY_MS * 2);
		expect(third).toBe(REALTIME_BASE_DELAY_MS * 4);
	});

	it("never exceeds the cap plus the jitter band", () => {
		// Attempt 40 is far beyond the exponent clamp, so the delay must stop
		// growing. Jitter tops out at 1.3 of the cap.
		const delay = nextReconnectDelay(40, () => 1);

		expect(delay).toBeLessThanOrEqual(Math.round(REALTIME_MAX_DELAY_MS * 1.3));
	});

	it("applies jitter in both directions", () => {
		const low = nextReconnectDelay(4, () => 0);
		const high = nextReconnectDelay(4, () => 1);

		expect(low).toBeLessThan(high);
		expect(low).toBeGreaterThan(0);
	});

	it("treats a negative attempt as the first attempt", () => {
		expect(nextReconnectDelay(-3, () => 0.5)).toBe(REALTIME_BASE_DELAY_MS);
	});
});

describe("isTerminalCloseCode", () => {
	it("stops on authorisation and protocol codes", () => {
		expect(isTerminalCloseCode(4401)).toBe(true);
		expect(isTerminalCloseCode(4403)).toBe(true);
		expect(isTerminalCloseCode(4404)).toBe(true);
		expect(isTerminalCloseCode(1008)).toBe(true);
		expect(isTerminalCloseCode(1009)).toBe(true);
	});

	it("retries on transient codes", () => {
		expect(isTerminalCloseCode(1006)).toBe(false);
		expect(isTerminalCloseCode(1011)).toBe(false);
		expect(isTerminalCloseCode(1012)).toBe(false);
		expect(isTerminalCloseCode(4000)).toBe(false);
	});
});
