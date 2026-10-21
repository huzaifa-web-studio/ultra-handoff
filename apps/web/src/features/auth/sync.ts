/**
 * Cross-tab synchronization for authentication state.
 *
 * Why: cookies are shared across tabs, but React state is not. When one tab
 * signs in, signs out, switches organization, or deletes an account, the other
 * tabs must refetch their session and react. This module centralizes the
 * broadcast event names and the receiving-side handling so every auth mutation
 * goes through one place.
 *
 * Used by: src/routes/__root.tsx (receiver) and the auth/org/account forms
 * (senders).
 */
import { useEffect } from "react";

import { authClient } from "./client";
import { broadcast, subscribe } from "#/lib/broadcast";

export type AuthBroadcastEvent =
	| "auth:signed-in"
	| "auth:signed-out"
	| "auth:session-refresh"
	| "auth:org-changed"
	| "auth:account-deleted";

export function broadcastAuth(
	event: AuthBroadcastEvent,
	payload?: Record<string, unknown>,
): void {
	broadcast(event, payload);
}

/**
 * Receiver hook. Mount once near the root of the app. It listens for auth
 * broadcasts from other tabs and refetches the session so `useSession` and
 * `useActiveOrganization` update, redirecting to `/` on sign-out.
 */
export function useAuthBroadcast(): void {
	useEffect(() => {
		const unsubs = [
			subscribe("auth:signed-in", async () => {
				await authClient.getSession();
			}),
			subscribe("auth:signed-out", async () => {
				await authClient.getSession();
				if (typeof window !== "undefined" && window.location.pathname !== "/") {
					window.location.assign("/");
				}
			}),
			subscribe("auth:session-refresh", async () => {
				await authClient.getSession();
			}),
			subscribe("auth:org-changed", async () => {
				await authClient.getSession();
			}),
			subscribe("auth:account-deleted", async () => {
				await authClient.getSession();
				if (typeof window !== "undefined" && window.location.pathname !== "/") {
					window.location.assign("/");
				}
			}),
		];

		return () => {
			for (const unsub of unsubs) unsub();
		};
	}, []);
}
