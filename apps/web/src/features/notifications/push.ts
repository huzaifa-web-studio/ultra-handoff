"use client";

/**
 * Web Push setup.
 *
 * Why the service worker is minimal: this is a SPA with its own Nitro bundle
 * and cache rules. The worker exists to receive a push and open the target, not
 * to cache the app, so it never creates a second version of the frontend.
 *
 * The flow is deliberately explicit:
 *   1. read the deployment config
 *   2. register the worker
 *   3. reuse an existing subscription or create one
 *   4. store it against the signed in account
 *
 * Used by: features/notifications/desktop.ts callers, the settings card and the
 * sign-out handler.
 */

import {
	fetchPushConfig,
	removePushSubscription,
	savePushSubscription,
} from "./api";

/** Convert the VAPID key from URL-safe base64 to the bytes the browser wants. */
function urlBase64ToUint8Array(value: string): Uint8Array {
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = window.atob(base64);
	const output = new Uint8Array(raw.length);

	for (let index = 0; index < raw.length; index += 1) {
		output[index] = raw.charCodeAt(index);
	}

	return output;
}

/** True when this browser can do service worker push at all. */
export function supportsPush(): boolean {
	return (
		typeof window !== "undefined" &&
		window.isSecureContext &&
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

/** Register the worker once. Returns null when it is not supported. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
	if (!supportsPush()) return null;

	try {
		return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
	} catch {
		return null;
	}
}

/** Turn an existing browser subscription into the shape the API stores. */
async function storeSubscription(
	subscription: PushSubscription,
): Promise<void> {
	const json = subscription.toJSON();
	const endpoint = json.endpoint;
	const p256dh = json.keys?.p256dh;
	const auth = json.keys?.auth;

	if (!endpoint || !p256dh || !auth) return;

	await savePushSubscription({
		endpoint,
		p256dh,
		auth,
		userAgent: navigator.userAgent,
	});
}

/**
 * Ensure this browser is subscribed and the server knows about it.
 *
 * Called after permission is granted, and again on a later sign in. Reusing the
 * existing subscription is what repairs a lost server row without showing the
 * permission prompt again.
 */
export async function enablePush(): Promise<
	{ status: "ok" } | { status: "unsupported" } | { status: "unavailable" }
> {
	if (!supportsPush()) return { status: "unsupported" };

	const config = await fetchPushConfig();

	if (!config?.enabled || !config.publicKey) {
		return { status: "unavailable" };
	}

	const registration = await registerServiceWorker();

	if (!registration) return { status: "unavailable" };

	const existing = await registration.pushManager.getSubscription();
	const subscription =
		existing ??
		(await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(
				config.publicKey,
			) as BufferSource,
		}));

	await storeSubscription(subscription);

	return { status: "ok" };
}

/** Repair the server row after a later sign in, without asking again. */
export async function syncExistingPush(): Promise<void> {
	if (!supportsPush()) return;

	try {
		const registration = await navigator.serviceWorker.getRegistration();

		if (!registration) return;

		const subscription = await registration.pushManager.getSubscription();

		if (subscription) await storeSubscription(subscription);
	} catch {
		// A missing subscription is not an error. The settings card can create
		// one when the person asks for it.
	}
}

/** Remove the subscription from the browser and from the account. */
export async function disablePush(): Promise<void> {
	if (!supportsPush()) return;

	try {
		const registration = await navigator.serviceWorker.getRegistration();
		const subscription = await registration?.pushManager.getSubscription();

		if (!subscription) return;

		const endpoint = subscription.endpoint;

		try {
			await subscription.unsubscribe();
		} finally {
			await removePushSubscription(endpoint);
		}
	} catch {
		// Signing out must never be blocked by a push cleanup failure.
	}
}
