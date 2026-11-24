/**
 * Realtime connection registry and heartbeats.
 *
 * Why this file: every open socket is tracked by user and project so a revoked
 * membership can be retired immediately, and the heartbeat keeps those records
 * honest. The registry lives here.
 *
 * Used by: `routes.ts`, `message.ts` and `connection.ts`.
 */

import { realtimeEnv } from "../../lib/env";
import {
	createRealtimeEnvelope,
	createUserRealtimeEnvelope,
	type RealtimeEventType,
} from "../protocol";
import { type RealtimeConnection, realtimeRegistry } from "../registry";
import type { GatewaySocket, RealtimeAuth } from "./handshake";
import { CLOSE_GOING_AWAY, CLOSE_RECONNECT } from "./handshake";

/** Read the auth slot back off the socket context. */
export function readAuth(data: unknown): RealtimeAuth | null {
	if (!data || typeof data !== "object") return null;

	const value = (data as Record<string, unknown>).realtimeAuth;

	if (!value || typeof value !== "object") return null;

	// The value is produced by `authorize` above in the same request, so a cast
	// is safe. It is still guarded against a missing object.
	return value as RealtimeAuth;
}

/** Read the connection id Bun stored on the socket data. */
export function connectionFor(data: unknown): RealtimeConnection | null {
	if (!data || typeof data !== "object") return null;

	const id = (data as Record<string, unknown>).realtimeConnectionId;

	if (typeof id !== "string") return null;

	return realtimeRegistry.get(id);
}

/** Send one envelope, swallowing a send on an already closed socket. */
export function sendEnvelope<T>(
	socket: GatewaySocket,
	projectId: string,
	type: RealtimeEventType,
	data: T,
): void {
	try {
		socket.send(JSON.stringify(createRealtimeEnvelope(projectId, type, data)));
	} catch {
		// The close handler owns cleanup. A failed send is not a request error.
	}
}

/** Send one personal envelope on a user scoped socket. */
export function sendUserEnvelope<T>(
	socket: GatewaySocket,
	organizationId: string,
	userId: string,
	type: RealtimeEventType,
	data: T,
): void {
	try {
		socket.send(
			JSON.stringify(
				createUserRealtimeEnvelope(organizationId, userId, type, data),
			),
		);
	} catch {
		// The close handler owns cleanup. A failed send is not a request error.
	}
}

/** Remove a connection then close it, in that order. */
export function retire(
	connection: RealtimeConnection,
	code: number,
	reason: string,
): void {
	realtimeRegistry.remove(connection.id);

	try {
		connection.socket.close(code, reason);
	} catch {
		try {
			connection.socket.terminate();
		} catch {
			// The socket is already gone. Nothing left to clean up.
		}
	}
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Sweep every connection once.
 *
 * One shared timer instead of one per socket: the registry is the only index,
 * so the work is bounded by live connections and no timer has to be tracked
 * for cleanup.
 */
export function sweepConnections(): void {
	const now = Date.now();
	const staleAfter = realtimeEnv.pingIntervalMs * 2.5;

	for (const connection of realtimeRegistry.all()) {
		// A long lived socket must eventually reconnect, so a revoked session or
		// a changed membership is re-checked instead of streaming forever.
		if (now - connection.connectedAt >= realtimeEnv.maxConnectionMs) {
			retire(connection, CLOSE_RECONNECT, "reconnect");
			continue;
		}

		// The browser answers a protocol ping with a pong automatically, so a
		// quiet connection here means the link is dead, not that the user is
		// idle.
		if (now - connection.lastPongAt > staleAfter) {
			retire(connection, CLOSE_GOING_AWAY, "pong timeout");
			continue;
		}

		try {
			connection.socket.ping();
		} catch {
			retire(connection, CLOSE_GOING_AWAY, "unresponsive");
		}
	}
}

/** Start the liveness sweep. Idempotent. */
export function startRealtimeHeartbeat(): void {
	if (heartbeatTimer) return;

	heartbeatTimer = setInterval(sweepConnections, realtimeEnv.pingIntervalMs);
	// The heartbeat must not be the reason the process stays alive.
	heartbeatTimer.unref();
}

/** Stop the liveness sweep. */
export function stopRealtimeHeartbeat(): void {
	if (!heartbeatTimer) return;

	clearInterval(heartbeatTimer);
	heartbeatTimer = null;
}
