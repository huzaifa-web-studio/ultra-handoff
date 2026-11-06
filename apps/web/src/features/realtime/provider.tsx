"use client";

/**
 * Realtime provider.
 *
 * Why mounted at the project workspace and not at the app root: the stream is
 * project scoped. A tab that is reading the project list has no project to
 * subscribe to, and opening a stream there would deliver nothing while costing
 * a connection.
 *
 * The provider is headless on purpose. It owns the connection and exposes one
 * subscription function, so features decide what an event means for their own
 * cache instead of the transport knowing about milestones or comments.
 *
 * Used by: features/projects/project-workspace.tsx. Feature hooks consume it
 * through `useRealtimeEvent`.
 */

import type { RealtimeEnvelope } from "@org/api";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import {
	acquireRealtimeSocket,
	type RealtimeStatus,
} from "#/lib/realtime/socket";

type RealtimeListener = (event: RealtimeEnvelope) => void;

type RealtimeApi = {
	/** Connection state, for a reconnect hint or a debug badge. */
	status: RealtimeStatus;
	/** Subscribe to application events. Returns an unsubscribe function. */
	subscribe: (listener: RealtimeListener) => () => void;
};

const RealtimeContext = createContext<RealtimeApi | null>(null);

export function RealtimeProvider({
	orgSlug,
	projectId,
	children,
}: {
	orgSlug: string;
	projectId: string;
	children: ReactNode;
}) {
	const [status, setStatus] = useState<RealtimeStatus>("idle");

	// The listener set lives in a ref so a consumer that re-renders does not
	// force the socket to re-subscribe.
	const listeners = useRef(new Set<RealtimeListener>());

	useEffect(() => {
		if (!orgSlug || !projectId) return;

		const lease = acquireRealtimeSocket(orgSlug, projectId);

		const offStatus = lease.socket.onStatus(setStatus);
		const offEvent = lease.socket.onEvent((event) => {
			for (const listener of listeners.current) listener(event);
		});

		return () => {
			offEvent();
			offStatus();
			lease.release();
		};
	}, [orgSlug, projectId]);

	const subscribe = useCallback((listener: RealtimeListener) => {
		listeners.current.add(listener);

		return () => {
			listeners.current.delete(listener);
		};
	}, []);

	const value = useMemo<RealtimeApi>(
		() => ({ status, subscribe }),
		[status, subscribe],
	);

	return (
		<RealtimeContext.Provider value={value}>
			{children}
		</RealtimeContext.Provider>
	);
}

/** Read the connection state and subscription function. */
export function useRealtime(): RealtimeApi {
	const value = useContext(RealtimeContext);

	if (!value) {
		throw new Error("useRealtime must be used inside a RealtimeProvider.");
	}

	return value;
}

/** Current connection state only. */
export function useRealtimeStatus(): RealtimeStatus {
	return useRealtime().status;
}

/**
 * Run a handler for every application event while mounted.
 *
 * The handler is held in a ref so an inline closure does not resubscribe on
 * every render, which would be the common case in a feature component.
 */
export function useRealtimeEvent(handler: (event: RealtimeEnvelope) => void) {
	const { subscribe } = useRealtime();
	const handlerRef = useRef(handler);

	useEffect(() => {
		handlerRef.current = handler;
	}, [handler]);

	useEffect(() => subscribe((event) => handlerRef.current(event)), [subscribe]);
}
