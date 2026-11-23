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
 * Why the cast is here and nowhere else: Better Auth's client type only covers
 * the fields it knows about, while `timezone` is an additional field declared
 * on the server. Widening the call site with `as never` erased the contract and
 * hid a silent failure that breaks reminders, so the single cast lives at this
 * library boundary instead.
 */
export async function reportTimezone(timezone: string): Promise<void> {
	await authClient.updateUser({
		timezone,
	} as Parameters<typeof authClient.updateUser>[0]);
}
