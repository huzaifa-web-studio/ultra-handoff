/**
 * Realtime control channel.
 *
 * Why a channel of its own: project events ride `realtime:events` and are
 * forwarded to every socket subscribed to that project. A membership change is
 * a server instruction, not content for a browser, so it travels on a separate
 * channel that the bus handles before any topic fan-out. That keeps control
 * frames out of the client envelope contract entirely.
 *
 * Used by: realtime/bus.ts and realtime/revoke.ts.
 */

/** Redis channel for server side control frames. */
export const REALTIME_CONTROL_CHANNEL = "realtime:control";

/**
 * Revoke every live connection a user holds.
 *
 * `projectId` narrows the revocation to one project. Omitting it removes the
 * user from every project in the organization, which is what an organization
 * member removal needs.
 */
export type MemberRevocation = {
	type: "revoke.member";
	organizationId: string;
	userId: string;
	projectId?: string;
};

export type RealtimeControlMessage = MemberRevocation;

/** True for a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/**
 * Decode one control frame.
 *
 * Redis is outside TypeScript, so every field is checked before it can drive a
 * socket close. Anything malformed is ignored rather than guessed at.
 */
export function parseControlMessage(
	input: unknown,
): RealtimeControlMessage | null {
	let value = input;

	if (typeof input === "string") {
		try {
			value = JSON.parse(input);
		} catch {
			return null;
		}
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) return null;

	const record = value as Record<string, unknown>;

	if (record.type !== "revoke.member") return null;

	const organizationId = record.organizationId;
	const userId = record.userId;
	const projectId = record.projectId;

	if (!isNonEmptyString(organizationId) || !isNonEmptyString(userId)) {
		return null;
	}

	if (projectId === undefined) {
		return { type: "revoke.member", organizationId, userId };
	}

	if (!isNonEmptyString(projectId)) return null;

	return { type: "revoke.member", organizationId, userId, projectId };
}
