/**
 * Realtime protocol contract.
 *
 * Why one file: the server and the browser have to agree on the envelope, the
 * event names and the Redis channel. Keeping them together means a new event
 * type is added once, and the client wrapper already validates against the
 * same version number.
 *
 * Scope rule: every event belongs to exactly one project. A socket subscribes
 * to one project topic, so a milestone surface never receives another
 * project's traffic and a forged project id in a message cannot widen the
 * stream. The project is always taken from the connection, never from the
 * payload.
 *
 * Used by: realtime/bus.ts, realtime/gateway.ts, realtime/registry.ts and the
 * type re-export in src/index.ts (which the web app imports as a type only).
 */

import { randomUUID } from "node:crypto";

/** Bump only for a breaking envelope change, never for a new event type. */
export const REALTIME_PROTOCOL_VERSION = 1;

/**
 * Single Redis channel every API instance publishes to.
 *
 * Why one channel and not one per project: a project topic is cheap to derive
 * from the envelope, and one channel means a new project needs no subscription
 * bookkeeping on the subscriber connection. The volume is human driven, so
 * fanning every event to every instance is not a cost.
 */
export const REALTIME_CHANNEL = "realtime:events";

/**
 * Bun topic one socket subscribes to.
 *
 * Bun's topic registry is per process, which is exactly why Redis still sits
 * in front of it: the topic handles local fan-out, Redis handles the cross
 * instance hop.
 */
export function projectTopic(projectId: string): string {
	return `project:${projectId}`;
}

/**
 * Every message the server may send.
 *
 * The comment and milestone names are declared now even though phases 1 and 2
 * publish them, so the envelope does not change when those land. Presence and
 * typing are inbound first, their outbound counterparts are reserved the same
 * way.
 */
export type RealtimeEventType =
	| "system.ready"
	| "system.pong"
	| "system.error"
	| "comment.created"
	| "comment.updated"
	| "comment.deleted"
	| "milestone.created"
	| "milestone.updated"
	| "milestone.deleted"
	| "presence.joined"
	| "presence.left"
	| "typing.started"
	| "typing.stopped";

/** Every message the browser may send. */
export type RealtimeInboundType =
	| "ping"
	| "presence.join"
	| "presence.leave"
	| "typing.start"
	| "typing.stop";

/** The wire envelope. `data` is narrowed per event type by the consumer. */
export type RealtimeEnvelope<T = unknown> = {
	v: typeof REALTIME_PROTOCOL_VERSION;
	/** Unique per message, so a consumer can drop a duplicate after a replay. */
	id: string;
	type: RealtimeEventType;
	/** ISO timestamp of the moment the write committed. */
	at: string;
	projectId: string;
	data: T;
};

/** Build an envelope. Always server side: the id and clock are authoritative. */
export function createRealtimeEnvelope<T>(
	projectId: string,
	type: RealtimeEventType,
	data: T,
): RealtimeEnvelope<T> {
	return {
		v: REALTIME_PROTOCOL_VERSION,
		id: randomUUID(),
		type,
		at: new Date().toISOString(),
		projectId,
		data,
	};
}

/**
 * A decoded inbound frame.
 *
 * A discriminated union rather than one loose shape: the gateway switches on
 * `type` and never has to re-check `milestoneId` inside each branch.
 */
export type RealtimeInboundMessage =
	| { type: "ping" }
	| { type: "presence.join"; milestoneId: string }
	| { type: "presence.leave"; milestoneId: string }
	| { type: "typing.start"; milestoneId: string }
	| { type: "typing.stop"; milestoneId: string };

/** Milestone ids are opaque strings, matching the route param limit. */
const MILESTONE_ID_MAX = 64;

/**
 * Decode one inbound frame.
 *
 * Accepts a raw string or an already decoded object. Elysia's default message
 * parser JSON-parses a frame that starts with `{` or `[` before the handler
 * runs, so a valid frame usually arrives as an object already. Accepting both
 * keeps the parser usable on its own and avoids re-serialising the frame.
 *
 * Returns null for anything malformed, unsupported or from another protocol
 * version. The gateway treats null as "ignore" instead of answering, so a
 * broken or hostile client cannot make the server echo forever. The connection
 * is still protected by the per connection frame rate limit.
 */
export function parseInboundMessage(
	input: unknown,
): RealtimeInboundMessage | null {
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

	// A missing version is accepted: the browser client is the only producer,
	// and a versionless ping is harmless. Anything else is a mismatch.
	if (record.v !== undefined && record.v !== REALTIME_PROTOCOL_VERSION) {
		return null;
	}

	const type = record.type;

	if (type === "ping") return { type };

	if (
		type === "presence.join" ||
		type === "presence.leave" ||
		type === "typing.start" ||
		type === "typing.stop"
	) {
		const milestoneId = record.milestoneId;

		if (
			typeof milestoneId !== "string" ||
			milestoneId.length === 0 ||
			milestoneId.length > MILESTONE_ID_MAX
		) {
			return null;
		}

		return { type, milestoneId };
	}

	return null;
}

/**
 * Validate an envelope that crossed Redis.
 *
 * Redis is outside TypeScript, and the subscriber must never forward a
 * malformed or foreign payload to a topic. Anything without a usable project
 * id and type is dropped here.
 */
export function parseRealtimeEnvelope(value: unknown): RealtimeEnvelope | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;

	const record = value as Record<string, unknown>;

	if (record.v !== REALTIME_PROTOCOL_VERSION) return null;
	if (typeof record.id !== "string") return null;
	if (typeof record.type !== "string") return null;
	if (typeof record.at !== "string") return null;
	if (typeof record.projectId !== "string" || record.projectId.length === 0) {
		return null;
	}

	return record as RealtimeEnvelope;
}
