/**
 * Membership revocation for live connections.
 *
 * Why this exists: a socket authorises once, at upgrade. Without this, someone
 * removed from a project or organization keeps receiving that traffic until the
 * connection is recycled. The gateway sweep is a backstop, not a solution.
 *
 * Scope: a connection is matched by user, organization and, when present,
 * project. Organization removal therefore closes every project stream the user
 * had open in that workspace.
 *
 * Used by: realtime/bus.ts (both the local fallback and the Redis subscriber).
 */

import { type MemberRevocation, parseControlMessage } from "./control";
import { REALTIME_CLOSE_REVOKED, realtimeRegistry } from "./registry";

/**
 * Close every live connection the revocation covers.
 *
 * Returns the number retired so a test, or a future metric, can assert that the
 * frame did what it claimed.
 */
export function applyRevocation(revocation: MemberRevocation): number {
	return realtimeRegistry.retireWhere(
		(connection) =>
			connection.userId === revocation.userId &&
			connection.organizationId === revocation.organizationId &&
			(revocation.projectId === undefined ||
				connection.projectId === revocation.projectId),
		REALTIME_CLOSE_REVOKED,
		"membership revoked",
	);
}

/** Decode and apply one raw control frame. Malformed frames are ignored. */
export function handleControlMessage(raw: unknown): void {
	const message = parseControlMessage(raw);

	if (message) applyRevocation(message);
}
