/**
 * Debounced callback.
 *
 * Why: autosave must not send a request per keystroke, but it also must not
 * lose the last keystrokes when the user switches milestones or closes the tab.
 * This hook keeps the pending arguments so `flush` can run the callback
 * immediately with the newest value.
 *
 * Used by: features/milestones (title and details autosave).
 */

import { useCallback, useEffect, useRef } from "react";

export type DebouncedCallback<TArgs extends unknown[]> = {
	/** Schedule the callback, replacing any pending call. */
	schedule: (...args: TArgs) => void;
	/** Drop a pending call without running it. */
	cancel: () => void;
	/** Run a pending call immediately, if there is one. */
	flush: () => void;
	/** True while a call is waiting. */
	isPending: () => boolean;
};

export function useDebouncedCallback<TArgs extends unknown[]>(
	callback: (...args: TArgs) => void,
	delayMs: number,
): DebouncedCallback<TArgs> {
	const callbackRef = useRef(callback);
	const timerRef = useRef<number | null>(null);
	const pendingRef = useRef<TArgs | null>(null);

	// Keep the latest closure without restarting a pending timer.
	useEffect(() => {
		callbackRef.current = callback;
	}, [callback]);

	const cancel = useCallback(() => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}

		pendingRef.current = null;
	}, []);

	const runPending = useCallback(() => {
		const args = pendingRef.current;
		pendingRef.current = null;

		if (args) callbackRef.current(...args);
	}, []);

	const flush = useCallback(() => {
		if (timerRef.current === null) return;

		window.clearTimeout(timerRef.current);
		timerRef.current = null;
		runPending();
	}, [runPending]);

	const schedule = useCallback(
		(...args: TArgs) => {
			pendingRef.current = args;

			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
			}

			timerRef.current = window.setTimeout(() => {
				timerRef.current = null;
				runPending();
			}, delayMs);
		},
		[delayMs, runPending],
	);

	// Flushing on unmount is what stops a fast milestone switch from dropping
	// the last edit. A timer that is merely cancelled would lose it.
	useEffect(() => {
		return () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
				timerRef.current = null;
				runPending();
			}
		};
	}, [runPending]);

	return {
		schedule,
		cancel,
		flush,
		isPending: () => pendingRef.current !== null,
	};
}
