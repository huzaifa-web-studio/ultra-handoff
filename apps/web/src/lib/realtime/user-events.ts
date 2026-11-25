/**
 * User scoped realtime fan-out.
 *
 * Why this module: one personal socket already carries notifications, read
 * state and direct messages. The provider that owns that socket is headless and
 * feature agnostic, so it forwards every event here. Feature modules subscribe
 * without opening a second connection, which is what keeps one tab at one
 * socket.
 *
 * Used by: features/notifications/realtime.tsx (publisher) and
 * features/messages/realtime.ts (subscriber).
 */

import type { RealtimeEnvelope } from "@org/api";
import { useEffect, useRef } from "react";

type Listener = (event: RealtimeEnvelope) => void;

const listeners = new Set<Listener>();

/** Forward one frame to every subscriber. A broken subscriber is isolated. */
export function emitUserRealtimeEvent(event: RealtimeEnvelope): void {
	for (const listener of [...listeners]) {
		try {
			listener(event);
		} catch {
			// One bad consumer must not tear down the stream for the others.
		}
	}
}

/** Subscribe to personal events. Returns an unsubscribe function. */
export function subscribeUserRealtime(listener: Listener): () => void {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}

/**
 * Run a handler for every personal event while mounted.
 *
 * The handler is held in a ref, so an inline closure does not resubscribe on
 * every render.
 */
export function useUserRealtimeEvent(handler: Listener): void {
	const ref = useRef(handler);

	useEffect(() => {
		ref.current = handler;
	}, [handler]);

	useEffect(() => subscribeUserRealtime((event) => ref.current(event)), []);
}
