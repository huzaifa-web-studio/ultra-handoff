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
import { broadcast, subscribe } from "#/lib/broadcast";
import { authClient } from "./client";

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
 * `useActiveOrganization` update, redirecting to `/` on sign-out and following
 * an organization switch or slug rename to the new address.
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
			subscribe<{ slug?: unknown; previousSlug?: unknown }>(
				"auth:org-changed",
				async (payload) => {
					await authClient.getSession();

					if (typeof window === "undefined") return;

					// Only follow the change when this tab is actually inside the
					// organization that moved. A tab on `/account` must not be
					// yanked into a workspace because another tab switched.
					const slug =
						typeof payload?.slug === "string" ? payload.slug : undefined;
					const previousSlug =
						typeof payload?.previousSlug === "string"
							? payload.previousSlug
							: undefined;

					if (!previousSlug) return;

					const segments = window.location.pathname.split("/").filter(Boolean);

					if (segments.length === 0 || segments[0] !== previousSlug) return;

					// A rename changes every URL under the old slug, and a
					// switch moves the workspace entirely. A full reload on the
					// new address is the reliable fix from outside the router.
					if (!slug) {
						window.location.assign("/");
						return;
					}

					segments[0] = slug;
					window.location.assign(`/${segments.join("/")}`);
				},
			),
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
