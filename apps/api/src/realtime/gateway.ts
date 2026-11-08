/**
 * Realtime WebSocket gateway.
 *
 * Why WebSocket and not SSE: the browser will also send presence and typing
 * frames on this same channel, so the connection is genuinely bidirectional.
 * Bun's native topic registry gives local fan-out with no controller bookkeeping
 * to leak, and Redis (see bus.ts) supplies the cross instance hop.
 *
 * Authentication happens before the upgrade, in `transform`. Elysia spreads the
 * resolved context into `ws.data`, so the connection keeps a verified tenant
 * for its whole lifetime. Authorisation failures still complete the upgrade and
 * close with an application code in the 4400 range: the browser needs a close
 * code to decide whether reconnecting is pointless, and an HTTP error during
 * the handshake does not surface as one.
 *
 * Topic rule: one socket, one project. The project id comes from the URL and is
 * checked against real project access, never from a frame.
 *
 * Used by: src/index.ts, realtime/index.ts.
 */

import { randomUUID } from "node:crypto";
import { Elysia, t } from "elysia";

import { withTenant } from "../db/tenant";
import { realtimeEnv, serverEnv } from "../lib/env";
import { resolveTenantScope } from "../middleware/tenant";
import { milestoneExistsInProject } from "../services/milestone.service";
import { loadProjectAccess } from "../services/project.service";
import {
	createRealtimeEnvelope,
	parseInboundMessage,
	projectTopic,
	type RealtimeEventType,
} from "./protocol";
import {
	type RealtimeConnection,
	type RealtimeSocketHandle,
	realtimeRegistry,
} from "./registry";

/** Close codes the client treats as terminal. */
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_NOT_FOUND = 4404;
const CLOSE_SERVER_ERROR = 1011;
const CLOSE_RECONNECT = 1012;
const CLOSE_GOING_AWAY = 1001;

/** The socket operations this file uses. Bun's socket satisfies the shape. */
type GatewaySocket = RealtimeSocketHandle & {
	send(data: string): number;
	subscribe(topic: string): void;
	/** Elysia's per-socket state, which carries our auth and connection id. */
	data: unknown;
};

/** Result of authorising one upgrade attempt. */
type RealtimeAuth =
	| {
			ok: true;
			projectId: string;
			tenant: { userId: string; organizationId: string };
	  }
	| { ok: false; code: number; reason: string };

/**
 * The object Bun keeps for the lifetime of one socket.
 *
 * Why this carries the auth result and the connection id: Elysia builds a new
 * `ElysiaWS` wrapper for every callback (`open`, `message`, `pong`, `close`), so
 * the wrapper cannot be used as an identity key. `ws.data` is the same object
 * for every callback, which makes it the only stable place to hang state.
 */
type RealtimeSocketData = {
	realtimeAuth?: RealtimeAuth;
	realtimeConnectionId?: string;
};

/**
 * Resolve the tenant and the project access for one upgrade.
 *
 * Why `resolveTenantScope` directly instead of the `tenant` macro: macros are
 * an HTTP route feature, and a WebSocket upgrade is an HTTP GET with params.
 * Calling the same resolver keeps one membership rule for both surfaces.
 */
async function authorize(
	request: Request,
	orgSlug: string,
	projectId: string,
): Promise<RealtimeAuth> {
	try {
		// A WebSocket upgrade is not covered by CORS. A hostile page cannot read
		// the stream, but it can still open it with the visitor's cookies if the
		// cookie policy allows that. Comparing Origin against the same web origin
		// the CORS config trusts closes that gap. A missing Origin is accepted:
		// only a non browser client omits it, and it still has to hold a session.
		const origin = request.headers.get("origin");
		const allowedOrigin = serverEnv.webUrl.replace(/\/$/, "");

		if (origin && origin !== allowedOrigin) {
			return { ok: false, code: CLOSE_FORBIDDEN, reason: "origin not allowed" };
		}

		const resolution = await resolveTenantScope(request.headers, orgSlug);

		if (resolution.kind === "unauthenticated") {
			return {
				ok: false,
				code: CLOSE_UNAUTHENTICATED,
				reason: "unauthenticated",
			};
		}

		// An unconfirmed account may not stream workspace data. Forbidden is
		// terminal in the browser policy, so the client stops rather than
		// retrying with the same unproven session.
		if (resolution.kind === "unverified") {
			return {
				ok: false,
				code: CLOSE_FORBIDDEN,
				reason: "email not verified",
			};
		}

		if (resolution.kind === "not-found") {
			return { ok: false, code: CLOSE_FORBIDDEN, reason: "forbidden" };
		}

		const tenant = resolution.tenant;
		const access = await withTenant(
			{ organizationId: tenant.organizationId, userId: tenant.userId },
			(tx) => loadProjectAccess(tx, tenant, projectId),
		);

		// A project the caller cannot see answers "not found", matching the
		// milestone endpoints, so the stream cannot confirm a project exists.
		if (!access) {
			return { ok: false, code: CLOSE_NOT_FOUND, reason: "not found" };
		}

		return {
			ok: true,
			projectId,
			tenant: {
				userId: tenant.userId,
				organizationId: tenant.organizationId,
			},
		};
	} catch {
		// A database failure is transient. 1011 tells the client to retry.
		return { ok: false, code: CLOSE_SERVER_ERROR, reason: "server error" };
	}
}

/** Read the auth slot back off the socket context. */
function readAuth(data: unknown): RealtimeAuth | null {
	if (!data || typeof data !== "object") return null;

	const value = (data as Record<string, unknown>).realtimeAuth;

	if (!value || typeof value !== "object") return null;

	// The value is produced by `authorize` above in the same request, so a cast
	// is safe. It is still guarded against a missing object.
	return value as RealtimeAuth;
}

/** Read the connection id Bun stored on the socket data. */
function connectionFor(data: unknown): RealtimeConnection | null {
	if (!data || typeof data !== "object") return null;

	const id = (data as Record<string, unknown>).realtimeConnectionId;

	if (typeof id !== "string") return null;

	return realtimeRegistry.get(id);
}

/** Send one envelope, swallowing a send on an already closed socket. */
function sendEnvelope<T>(
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

/** Remove a connection then close it, in that order. */
function retire(
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
function sweepConnections(): void {
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

/**
 * Handle one inbound frame.
 *
 * Async because a presence join now confirms the milestone belongs to the
 * connection's project before it is indexed. The socket callback hands the work
 * here so the adapter callback stays synchronous and a slow query cannot block
 * the event loop it runs on.
 */
async function handleMessage(ws: GatewaySocket, raw: unknown): Promise<void> {
	const connection = connectionFor(ws.data);

	// Messages can beat a closed open handler by a tick. Treat an unknown
	// socket as unauthenticated instead of trusting the frame.
	if (!connection) {
		ws.close(CLOSE_UNAUTHENTICATED, "unauthenticated");
		return;
	}

	if (typeof raw === "string") {
		if (Buffer.byteLength(raw) > realtimeEnv.maxFrameBytes) {
			ws.close(1009, "frame too large");
			return;
		}
	} else if (raw instanceof Uint8Array) {
		// Binary frames are not part of the protocol. A JSON object frame
		// arrives already parsed by Elysia, which is why only binary is refused
		// here.
		ws.close(1003, "text frames only");
		return;
	}

	if (
		!realtimeRegistry.consumeFrame(
			connection.id,
			realtimeEnv.maxFramesPerSecond,
		)
	) {
		ws.close(1008, "rate limited");
		return;
	}

	const message = parseInboundMessage(raw);

	// Unsupported or malformed frames are ignored on purpose. Answering them
	// would let a broken client make the server echo forever.
	if (!message) return;

	realtimeRegistry.touchSeen(connection.id);

	switch (message.type) {
		case "ping":
			sendEnvelope(ws, connection.projectId, "system.pong", {
				at: new Date().toISOString(),
			});
			break;
		case "presence.join": {
			// The milestone id comes from the client, so it cannot widen the
			// topic. Confirming it belongs to the authorised project keeps one
			// project's presence index from accepting another project's id.
			const allowed = await withTenant(
				{
					organizationId: connection.organizationId,
					userId: connection.userId,
				},
				(tx) =>
					milestoneExistsInProject(
						tx,
						connection.organizationId,
						connection.projectId,
						message.milestoneId,
					),
			).catch(() => false);

			// A missing milestone, or a membership change that landed mid frame,
			// is ignored. Either way the socket simply does not join.
			if (allowed) {
				realtimeRegistry.subscribeMilestone(connection.id, message.milestoneId);
			}
			break;
		}
		case "presence.leave":
			// Leaving never grants access, so it needs no lookup.
			realtimeRegistry.unsubscribeMilestone(connection.id, message.milestoneId);
			break;
		case "typing.start":
		case "typing.stop":
			// Reserved for the presence phase. The frame is accepted and
			// timestamped so the protocol does not change later, but it is not
			// broadcast until typing has a consumer.
			break;
	}
}

export const realtimeRoutes = new Elysia({ name: "realtime" }).ws(
	"/orgs/:orgSlug/projects/:projectId/realtime",
	{
		params: t.Object({
			orgSlug: t.String({ minLength: 1, maxLength: 255 }),
			projectId: t.String({ minLength: 1, maxLength: 64 }),
		}),

		/**
		 * Authorise before the upgrade. The result is placed on the context so
		 * the adapter copies it into `ws.data`.
		 */
		transform: async (context) => {
			const auth = await authorize(
				context.request,
				context.params.orgSlug,
				context.params.projectId,
			);

			(context as unknown as RealtimeSocketData).realtimeAuth = auth;
		},

		open(ws) {
			const auth = readAuth(ws.data);

			if (!auth || !auth.ok) {
				const code = auth && !auth.ok ? auth.code : CLOSE_UNAUTHENTICATED;
				const reason = auth && !auth.ok ? auth.reason : "unauthenticated";

				ws.close(code, reason);
				return;
			}

			const now = Date.now();
			const connection: RealtimeConnection = {
				id: randomUUID(),
				userId: auth.tenant.userId,
				organizationId: auth.tenant.organizationId,
				projectId: auth.projectId,
				connectedAt: now,
				lastSeenAt: now,
				lastPongAt: now,
				milestones: new Set(),
				windowStartedAt: now,
				windowFrames: 0,
				socket: ws,
			};

			realtimeRegistry.add(connection);
			ws.subscribe(projectTopic(auth.projectId));

			// Stable for the life of this socket, unlike the wrapper Elysia
			// creates per callback.
			(ws.data as unknown as RealtimeSocketData).realtimeConnectionId =
				connection.id;

			// The ready frame is the client's proof that auth and the topic
			// subscription both succeeded, so it can stop showing "connecting".
			sendEnvelope(ws, auth.projectId, "system.ready", {
				connectionId: connection.id,
				pingIntervalMs: realtimeEnv.pingIntervalMs,
			});
		},

		message(ws, raw) {
			void handleMessage(ws, raw);
		},

		pong(ws) {
			const connection = connectionFor(ws.data);

			if (connection) realtimeRegistry.touchPong(connection.id);
		},

		close(ws) {
			const connection = connectionFor(ws.data);

			if (connection) realtimeRegistry.remove(connection.id);
		},
	},
);
