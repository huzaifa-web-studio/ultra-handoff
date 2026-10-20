/**
 * Reusable resend cooldown.
 *
 * Why: verification emails and password reset emails share the same rule. The
 * button stays disabled for a minute so one click cannot queue several
 * messages, and both screens count down identically.
 *
 * Used by: features/auth/sign-up-form.tsx and forgot-password-form.tsx.
 */

import { useCallback, useEffect, useState } from "react";

/** Wait before a second email can be requested. */
export const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;

type Cooldown = {
	/** Seconds left before the action is allowed again. */
	remaining: number;
	/** True while `remaining` is above zero. */
	isActive: boolean;
	/** Start, or restart, the wait. */
	start: () => void;
	/** Clear the wait immediately. */
	clear: () => void;
};

export function useCooldown(
	seconds: number = DEFAULT_RESEND_COOLDOWN_SECONDS,
): Cooldown {
	const [remaining, setRemaining] = useState(0);

	/**
	 * A timeout that re-arms itself is enough. The UI shows whole seconds, so
	 * drift inside a tick does not matter.
	 */
	useEffect(() => {
		if (remaining <= 0) return;

		const timer = window.setTimeout(() => {
			setRemaining((current) => Math.max(0, current - 1));
		}, 1000);

		return () => window.clearTimeout(timer);
	}, [remaining]);

	const start = useCallback(() => {
		setRemaining(seconds);
	}, [seconds]);

	const clear = useCallback(() => {
		setRemaining(0);
	}, []);

	return { remaining, isActive: remaining > 0, start, clear };
}
