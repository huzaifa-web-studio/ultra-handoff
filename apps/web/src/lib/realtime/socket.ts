/**
 * Realtime WebSocket client.
 *
 * Why a class with a module level lease map: a project workspace renders once,
 * but React remounts effects in development and a route transition can unmount
 * and remount the shell in the same tick. A shared socket per project keeps one
 * connection per tab instead of one per mount, and the lease count is what makes
 * that safe.
 *
 * What the wrapper owns that the browser does not:
 *   - reconnect with exponential backoff and jitter
 *   - an application heartbeat, because a browser socket cannot observe the
 *     protocol level ping that the server sends
 *   - close code policy, so an authorisation failure stops instead of looping
 *   - an immediate retry when the network comes back or the tab is shown again
 *
 * Frames are validated against the shared protocol version and the connection's
 * project id, so a stale or misrouted payload is dropped rather than applied to
 * the wrong milestone.
 *
 * Used by: features/realtime/provider.tsx.
 */

import type { RealtimeEnvelope } from "@org/api";

import { API_ORIGIN } from "#/lib/api";
import {
	isTerminalCloseCode,
	nextReconnectDelay,
	REALTIME_CLOSE_GRACE_MS,
	REALTIME_HEARTBEAT_MS,
	REALTIME_SILENCE_MS,
} from "./policy";

/** The protocol version the client speaks. Mirrored in the server contract. */
const PROTOCOL_VERSION = 1;

/** The client's own close code, distinct from any server code. */
const CLOSE_CLIENT_RESET = 4000;

export type RealtimeStatus =
	| "idle"
	| "connecting"
	| "open"
	| "reconnecting"
	| "closed";

type EventListener = (event: RealtimeEnvelope) => void;
type StatusListener = (status: RealtimeStatus) => void;

/** Build the socket URL from the same origin the HTTP client uses. */
export function realtimeUrl(orgSlug: string, projectId: string): string {
	const url = new URL(
		`/orgs/${encodeURIComponent(orgSlug)}/projects/${encodeURIComponent(
			projectId,
		)}/realtime`,
		API_ORIGIN,
	);

	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

	return url.toString();
}

export class RealtimeSocket {
	private socket: WebSocket | null = null;
	private attempt = 0;
	private stopped = false;
	/**
	 * Bumped for every socket this instance creates.
	 *
	 * Why: a heartbeat reset can replace a socket while the old one still has
	 * queued callbacks. Without this guard the old socket's close handler would
	 * clear the new socket or schedule a second reconnect.
	 */
	private generation = 0;
	private status: RealtimeStatus = "idle";
	private lastMessageAt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private listeningToWindow = false;

	private readonly eventListeners = new Set<EventListener>();
	private readonly statusListeners = new Set<StatusListener>();

	constructor(
		private readonly orgSlug: string,
		private readonly projectId: string,
	) {}

	/** Open the socket unless one is already open, opening or waiting to retry. */
	connect(): void {
		if (typeof window === "undefined") return;
		if (this.socket || this.reconnectTimer) return;

		this.stopped = false;
		this.bindWindowEvents();
		this.openSocket();
	}

	/** Keep this socket alive while a caller holds the lease. */
	onEvent(listener: EventListener): () => void {
		this.eventListeners.add(listener);

		return () => {
			this.eventListeners.delete(listener);
		};
	}

	/** Observe connection state. The current value is delivered immediately. */
	onStatus(listener: StatusListener): () => void {
		this.statusListeners.add(listener);
		listener(this.status);

		return () => {
			this.statusListeners.delete(listener);
		};
	}

	/** Close for good. A later `connect` would start from a clean slate. */
	dispose(): void {
		this.stopped = true;
		// Invalidate callbacks from the socket being closed below.
		this.generation += 1;
		this.clearReconnect();
		this.stopHeartbeat();
		this.unbindWindowEvents();

		const socket = this.socket;

		this.socket = null;

		try {
			socket?.close(1000, "client closed");
		} catch {
			// Already closed. Nothing to release.
		}

		this.setStatus("closed");
	}

	/** Current state, for a consumer that subscribes once. */
	getStatus(): RealtimeStatus {
		return this.status;
	}

	private setStatus(status: RealtimeStatus): void {
		if (this.status === status) return;

		this.status = status;

		for (const listener of this.statusListeners) listener(status);
	}

	private openSocket(): void {
		if (this.stopped || typeof WebSocket === "undefined") return;

		this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

		const generation = ++this.generation;

		let socket: WebSocket;

		try {
			socket = new WebSocket(realtimeUrl(this.orgSlug, this.projectId));
		} catch {
			this.scheduleReconnect();
			return;
		}

		this.socket = socket;

		socket.onopen = () => {
			if (generation !== this.generation) return;

			// A fresh connection resets the backoff, so the next drop retries
			// quickly instead of inheriting an old outage's delay.
			this.attempt = 0;
			this.lastMessageAt = Date.now();
			this.setStatus("open");
			this.startHeartbeat();
		};

		socket.onmessage = (event: MessageEvent) => {
			if (generation !== this.generation) return;

			this.handleMessage(event.data);
		};

		socket.onclose = (event: CloseEvent) => {
			if (generation !== this.generation) return;

			this.socket = null;
			this.stopHeartbeat();
			this.handleClose(event.code);
		};

		socket.onerror = () => {
			// The browser always follows an error with a close event, which is
			// where the retry decision lives. Nothing to do here.
		};
	}

	/** Validate and dispatch one frame. */
	private handleMessage(data: unknown): void {
		if (typeof data !== "string") return;

		this.lastMessageAt = Date.now();

		let value: unknown;

		try {
			value = JSON.parse(data);
		} catch {
			return;
		}

		if (!value || typeof value !== "object" || Array.isArray(value)) return;

		const record = value as Record<string, unknown>;

		if (record.v !== PROTOCOL_VERSION) return;
		if (record.projectId !== this.projectId) return;
		if (typeof record.type !== "string") return;

		// Control frames keep the liveness clock but are not application
		// events, so a consumer never sees them.
		if (record.type === "system.ready" || record.type === "system.pong") {
			return;
		}

		if (record.type === "system.error") return;

		for (const listener of this.eventListeners) {
			try {
				listener(value as RealtimeEnvelope);
			} catch {
				// One bad consumer must not tear down the stream for the others.
			}
		}
	}

	/** Start the application heartbeat for an open socket. */
	private startHeartbeat(): void {
		this.stopHeartbeat();

		this.heartbeatTimer = setInterval(() => {
			const socket = this.socket;

			if (!socket || socket.readyState !== WebSocket.OPEN) return;

			// No traffic at all for a full silence window means the connection is
			// dead in a way the browser has not noticed. Reset it ourselves so
			// the backoff path takes over.
			if (Date.now() - this.lastMessageAt > REALTIME_SILENCE_MS) {
				try {
					socket.close(CLOSE_CLIENT_RESET, "heartbeat timeout");
				} catch {
					this.socket = null;
					this.scheduleReconnect();
				}

				return;
			}

			try {
				socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "ping" }));
			} catch {
				// A send on a closing socket also produces a close event.
			}
		}, REALTIME_HEARTBEAT_MS);
	}

	private stopHeartbeat(): void {
		if (!this.heartbeatTimer) return;

		clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = null;
	}

	private handleClose(code: number): void {
		if (this.stopped) return;

		// Terminal codes mean retrying cannot help. Leave the socket closed and
		// let the UI show why instead of hammering the API.
		if (isTerminalCloseCode(code)) {
			this.stopped = true;
			this.setStatus("closed");
			return;
		}

		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (this.stopped) return;

		this.clearReconnect();

		const delay = nextReconnectDelay(this.attempt);

		this.attempt += 1;
		this.setStatus("reconnecting");

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.openSocket();
		}, delay);
	}

	private clearReconnect(): void {
		if (!this.reconnectTimer) return;

		clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
	}

	/** Retry at once when the network returns or the tab is shown again. */
	private readonly handleOnline = () => {
		this.retryNow();
	};

	private readonly handleVisibility = () => {
		if (document.visibilityState === "visible") this.retryNow();
	};

	private retryNow(): void {
		if (this.stopped || this.socket) return;
		if (this.status !== "reconnecting") return;

		this.clearReconnect();
		this.attempt = 0;
		this.openSocket();
	}

	private bindWindowEvents(): void {
		if (this.listeningToWindow) return;

		window.addEventListener("online", this.handleOnline);
		document.addEventListener("visibilitychange", this.handleVisibility);
		this.listeningToWindow = true;
	}

	private unbindWindowEvents(): void {
		if (!this.listeningToWindow) return;

		window.removeEventListener("online", this.handleOnline);
		document.removeEventListener("visibilitychange", this.handleVisibility);
		this.listeningToWindow = false;
	}
}

/** One shared socket per project, with a lease count. */
type LeaseEntry = {
	socket: RealtimeSocket;
	refs: number;
	closeTimer: ReturnType<typeof setTimeout> | null;
};

const leases = new Map<string, LeaseEntry>();

/** A held connection. Releasing the last lease closes it after a short grace. */
export type RealtimeLease = {
	socket: RealtimeSocket;
	release: () => void;
};

function leaseKey(orgSlug: string, projectId: string): string {
	return `${orgSlug}:${projectId}`;
}

/**
 * Take a reference on the project's socket, opening it if needed.
 *
 * The grace period absorbs a remount in the same tick, which is what React does
 * in development and what a route transition can do in production. Without it,
 * every remount would close and reopen the connection.
 */
export function acquireRealtimeSocket(
	orgSlug: string,
	projectId: string,
): RealtimeLease {
	const key = leaseKey(orgSlug, projectId);
	let entry = leases.get(key);

	if (!entry) {
		entry = {
			socket: new RealtimeSocket(orgSlug, projectId),
			refs: 0,
			closeTimer: null,
		};

		leases.set(key, entry);
	}

	entry.refs += 1;

	if (entry.closeTimer) {
		clearTimeout(entry.closeTimer);
		entry.closeTimer = null;
	}

	entry.socket.connect();

	const held = entry;

	return {
		socket: held.socket,
		release: () => {
			held.refs -= 1;

			if (held.refs > 0) return;

			if (held.closeTimer) clearTimeout(held.closeTimer);

			held.closeTimer = setTimeout(() => {
				// A new lease may have arrived inside the grace window.
				if (held.refs > 0) return;

				held.socket.dispose();
				leases.delete(key);
			}, REALTIME_CLOSE_GRACE_MS);
		},
	};
}
