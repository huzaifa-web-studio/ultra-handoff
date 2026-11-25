/**
 * The account timezone.
 *
 * Why a module: the reminder sweep computes each person's local day from
 * `user.timezone`, and two surfaces need that zone. The shell reports it once
 * per session and the desktop alerts card displays it, so the detection lives
 * in one place instead of drifting between them.
 *
 * Used by: routes/_app.tsx and features/notifications/desktop-alerts-card.tsx.
 */

import { authClient } from "./client";

/** The detected IANA zone, falling back to UTC when the browser refuses. */
export function detectedTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/**
 * Send the browser's timezone to the account.
 *
 * The auth client's `inferAdditionalFields` plugin now declares `timezone`, so
 * it is part of the `updateUser` input type and no cast is needed.
 */
export async function reportTimezone(timezone: string): Promise<void> {
	await authClient.updateUser({ timezone });
}
