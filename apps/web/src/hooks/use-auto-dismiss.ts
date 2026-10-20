/**
 * Auto-dismiss a transient success message.
 *
 * Why: a confirmation should confirm the action, not become permanent page
 * furniture. Errors are intentionally left alone, because the user needs to
 * read them and decide what to do.
 *
 * The callback is kept in a ref so an inline arrow function does not reset the
 * timer on every render. The timer restarts when the message itself changes,
 * which is what a new successful action should do.
 *
 * Used by: the account settings cards.
 */

import { useEffect, useRef } from "react";

export function useAutoDismiss(
	message: string | null | undefined,
	clear: () => void,
	delayMs = 3000,
): void {
	const clearRef = useRef(clear);
	clearRef.current = clear;

	useEffect(() => {
		if (!message) return;

		const timer = window.setTimeout(() => {
			clearRef.current();
		}, delayMs);

		return () => window.clearTimeout(timer);
	}, [message, delayMs]);
}
