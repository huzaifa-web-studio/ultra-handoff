/**
 * Tiny cross-tab broadcast helper.
 *
 * Why: the app runs in multiple browser tabs that share cookies but not React
 * state. Mutations in one tab (sign in, sign out, active organization change)
 * must reach the others so they refetch and stay consistent. BroadcastChannel
 * is used when available, with a localStorage storage-event fallback for older
 * browsers and for tabs that cannot share a channel.
 *
 * Usage:
 *   broadcast("auth:signed-out", { reason: "user" });
 *   const unsubscribe = subscribe("auth:signed-out", (payload) => { ... });
 *
 * Used by: src/features/auth/sync.ts and any future feature needing cross-tab
 * state propagation.
 */
const CHANNEL_NAME = "handoff";
const STORAGE_KEY = "handoff:broadcast";
const tabId =
	typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `tab-${Math.random().toString(36).slice(2)}`;

type BroadcastEnvelope<T = unknown> = {
	type: string;
	payload: T;
	origin: string;
	ts: number;
};

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
	if (
		typeof window === "undefined" ||
		typeof BroadcastChannel === "undefined"
	) {
		return null;
	}
	if (!channel) {
		channel = new BroadcastChannel(CHANNEL_NAME);
	}
	return channel;
}

export function broadcast<T = unknown>(type: string, payload?: T): void {
	const envelope: BroadcastEnvelope<T> = {
		type,
		payload: payload as T,
		origin: tabId,
		ts: Date.now(),
	};

	const ch = getChannel();
	if (ch) {
		try {
			ch.postMessage(envelope);
		} catch {
			// Fall through to the storage fallback below.
		}
	}

	// Storage fallback: writing and removing the key fires a `storage` event
	// in every OTHER tab (not this one), which the subscribe() handler reads.
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Private mode / storage disabled: cross-tab sync unavailable.
	}
}

export function subscribe<T = unknown>(
	type: string,
	handler: (payload: T) => void,
): () => void {
	const ch = getChannel();
	const onMessage = (event: MessageEvent) => {
		const data = event.data as BroadcastEnvelope<T> | undefined;
		if (!data || data.type !== type || data.origin === tabId) return;
		handler(data.payload);
	};
	if (ch) {
		ch.addEventListener("message", onMessage);
	}

	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY || !event.newValue) return;
		try {
			const data = JSON.parse(event.newValue) as BroadcastEnvelope<T>;
			if (data.type !== type || data.origin === tabId) return;
			handler(data.payload);
		} catch {
			// Ignore malformed payloads.
		}
	};
	window.addEventListener("storage", onStorage);

	return () => {
		if (ch) ch.removeEventListener("message", onMessage);
		window.removeEventListener("storage", onStorage);
	};
}
