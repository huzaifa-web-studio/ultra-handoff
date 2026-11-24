/**
 * Realtime inbound frame handling.
 *
 * Why this file: presence, typing and ping frames all arrive on the same
 * channel and must be validated against the socket's own project. Keeping the
 * switch together means no frame can bypass that check.
 *
 * Used by: `routes.ts`.
 */

import { withTenant } from "../../db/tenant";
import { realtimeEnv } from "../../lib/env";
import { milestoneExistsInProject } from "../../services/milestone";
import { parseInboundMessage } from "../protocol";
import { realtimeRegistry } from "../registry";
import { connectionFor, sendEnvelope, sendUserEnvelope } from "./connections";
import type { GatewaySocket } from "./handshake";
import { CLOSE_UNAUTHENTICATED } from "./handshake";

/**
 * Handle one inbound frame.
 *
 * Async because a presence join now confirms the milestone belongs to the
 * connection's project before it is indexed. The socket callback hands the work
 * here so the adapter callback stays synchronous and a slow query cannot block
 * the event loop it runs on.
 */
export async function handleMessage(
	ws: GatewaySocket,
	raw: unknown,
): Promise<void> {
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
			if (connection.projectId) {
				sendEnvelope(ws, connection.projectId, "system.pong", {
					at: new Date().toISOString(),
				});
			} else {
				sendUserEnvelope(
					ws,
					connection.organizationId,
					connection.userId,
					"system.pong",
					{ at: new Date().toISOString() },
				);
			}
			break;
		case "presence.join": {
			// A personal socket has no presence group.
			if (!connection.projectId) break;

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
						connection.projectId as string,
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
