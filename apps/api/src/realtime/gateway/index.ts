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

import { Elysia, t } from "elysia";
import { realtimeRegistry } from "../registry";
import { connectionFor, readAuth } from "./connections";
import type { RealtimeSocketData } from "./handshake";
import {
	authorizeProject,
	authorizeUser,
	CLOSE_UNAUTHENTICATED,
} from "./handshake";
import { handleMessage } from "./message";
import { openConnection } from "./open";

export const realtimeRoutes = new Elysia({ name: "realtime" })
	.ws("/orgs/:orgSlug/projects/:projectId/realtime", {
		params: t.Object({
			orgSlug: t.String({ minLength: 1, maxLength: 255 }),
			projectId: t.String({ minLength: 1, maxLength: 64 }),
		}),

		/**
		 * Authorise before the upgrade. The result is placed on the context so
		 * the adapter copies it into `ws.data`.
		 */
		transform: async (context) => {
			const auth = await authorizeProject(
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

			openConnection(ws, auth);
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
	})
	/**
	 * Personal stream: the bell, the unread badge and cross tab read state.
	 *
	 * It lives under the organization slug, not under a project, because the
	 * user is browsing the workspace list, settings or invitations when many of
	 * these arrive.
	 */
	.ws("/orgs/:orgSlug/realtime", {
		params: t.Object({
			orgSlug: t.String({ minLength: 1, maxLength: 255 }),
		}),

		transform: async (context) => {
			const auth = await authorizeUser(context.request, context.params.orgSlug);

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

			openConnection(ws, auth);
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
	});

export { startRealtimeHeartbeat, stopRealtimeHeartbeat } from "./connections";
