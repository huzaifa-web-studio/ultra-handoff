/**
 * Realtime connection open.
 *
 * Why this file: opening a socket validates the project access, registers the
 * connection and subscribes the topic in one sequence.
 *
 * Used by: `routes.ts`.
 */

import { randomUUID } from "node:crypto";
import { realtimeEnv } from "../../lib/env";
import { projectTopic, userTopic } from "../protocol";
import { type RealtimeConnection, realtimeRegistry } from "../registry";
import { sendEnvelope, sendUserEnvelope } from "./connections";
import type {
	GatewaySocket,
	RealtimeAuth,
	RealtimeSocketData,
} from "./handshake";

/**
 * Register one authorised connection and send its ready frame.
 *
 * Shared by the project socket and the personal socket. The only difference is
 * the topic and the scope of the ready frame, both derived from `auth`.
 */
export function openConnection(
	ws: GatewaySocket,
	auth: RealtimeAuth & { ok: true },
) {
	const now = Date.now();
	const connection: RealtimeConnection = {
		id: randomUUID(),
		userId: auth.tenant.userId,
		organizationId: auth.tenant.organizationId,
		projectId: auth.scope === "project" ? auth.projectId : undefined,
		connectedAt: now,
		lastSeenAt: now,
		lastPongAt: now,
		milestones: new Set(),
		windowStartedAt: now,
		windowFrames: 0,
		socket: ws,
	};

	realtimeRegistry.add(connection);

	if (auth.scope === "project") {
		ws.subscribe(projectTopic(auth.projectId));
	} else {
		ws.subscribe(userTopic(auth.tenant.organizationId, auth.tenant.userId));
	}

	// Stable for the life of this socket, unlike the wrapper Elysia creates
	// per callback.
	(ws.data as unknown as RealtimeSocketData).realtimeConnectionId =
		connection.id;

	// The ready frame is the client's proof that auth and the topic
	// subscription both succeeded, so it can stop showing "connecting".
	if (auth.scope === "project") {
		sendEnvelope(ws, auth.projectId, "system.ready", {
			connectionId: connection.id,
			scope: "project",
			pingIntervalMs: realtimeEnv.pingIntervalMs,
		});
	} else {
		sendUserEnvelope(
			ws,
			auth.tenant.organizationId,
			auth.tenant.userId,
			"system.ready",
			{
				connectionId: connection.id,
				scope: "user",
				pingIntervalMs: realtimeEnv.pingIntervalMs,
			},
		);
	}
}
