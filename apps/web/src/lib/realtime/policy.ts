/**
 * Reconnect policy for the realtime socket.
 *
 * Why a separate module: this is the part that has to be right at 3am, and it
 * is pure. Keeping it free of WebSocket and React lets it be unit tested
 * without a browser, which is the only way the backoff bounds stay honest.
 *
 * Used by: lib/realtime/socket.ts.
 */

/** First retry waits about half a second, which feels immediate without a storm. */
export const REALTIME_BASE_DELAY_MS = 500;

/** Upper bound before jitter. A reconnect never waits longer than this. */
export const REALTIME_MAX_DELAY_MS = 30_000;

/** How often the client proves the socket is still alive. */
export const REALTIME_HEARTBEAT_MS = 20_000;

/** Silence longer than this means the link is dead, not that nobody is typing. */
export const REALTIME_SILENCE_MS = 50_000;

/** Grace period before a released socket actually closes, so a remount reuses it. */
export const REALTIME_CLOSE_GRACE_MS = 1_500;

/**
 * Codes that will never succeed on retry.
 *
 * 4401 to 4404 are the server's application codes for "not you" and "not
 * here". 1008 means this client is being rate limited or broke the protocol,
 * and 1009 means a frame was too large, so reconnecting with the same code
 * would repeat the failure. The user fixes those by signing in again or by
 * reloading after an update.
 */
const TERMINAL_CLOSE_CODES = new Set([1008, 1009, 4401, 4403, 4404]);

/** True when the client should stop reconnecting for this close code. */
export function isTerminalCloseCode(code: number): boolean {
	return TERMINAL_CLOSE_CODES.has(code);
}

/**
 * Delay before retry `attempt`, with jitter.
 *
 * The exponential term is capped before jitter so a long outage cannot grow the
 * delay without bound. Jitter is 0.7 to 1.3, which breaks the lockstep when
 * every tab reconnects after a deploy: without it, a server restart produces a
 * synchronised stampede that can take the API down again.
 */
export function nextReconnectDelay(
	attempt: number,
	random: () => number = Math.random,
): number {
	const exponent = Math.min(Math.max(attempt, 0), 6);
	const capped = Math.min(
		REALTIME_MAX_DELAY_MS,
		REALTIME_BASE_DELAY_MS * 2 ** exponent,
	);

	return Math.round(capped * (0.7 + random() * 0.6));
}
