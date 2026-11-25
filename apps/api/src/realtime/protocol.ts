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
 * The two scopes one socket can carry.
 *
 * A project socket receives content for one project workspace: comments,
 * milestones and change requests. A user socket receives personal traffic:
 * notifications and read state for the signed in person. The discriminator is
 * additive so an existing project tab keeps working without a version bump.
 */
export type RealtimeScope = "project" | "user";

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
 * Bun topic for one person inside one workspace.
 *
 * The organization is part of the topic on purpose. Notification rows are
 * workspace scoped, so the same person in two workspaces must not receive one
 * workspace's bell on the other workspace's connection.
 */
export function userTopic(organizationId: string, userId: string): string {
	return `user:${organizationId}:${userId}`;
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
	| "milestone.scope.changed"
	| "change_request.created"
	| "change_request.updated"
	| "conversation.message.created"
	| "conversation.message.updated"
	| "conversation.message.deleted"
	| "conversation.read"
	| "presence.joined"
	| "presence.left"
	| "typing.started"
	| "typing.stopped"
	/** Personal traffic, always published on a user topic. */
	| "notification.created"
	| "notification.read"
	| "comment.read";

/** Every message the browser may send. */
export type RealtimeInboundType =
	| "ping"
	| "presence.join"
	| "presence.leave"
	| "typing.start"
	| "typing.stop"
	| "dm.typing.start"
	| "dm.typing.stop";

/**
 * The wire envelope. `data` is narrowed per event type by the consumer.
 *
 * `scope` is optional for backwards compatibility. A project envelope without
 * a scope is treated as `project`, which is what every release before the
 * personal channel produced. A user envelope always carries `organizationId`
 * and `userId` and never a `projectId`.
 */
export type RealtimeEnvelope<T = unknown> = {
	v: typeof REALTIME_PROTOCOL_VERSION;
	/** Unique per message, so a consumer can drop a duplicate after a replay. */
	id: string;
	type: RealtimeEventType;
	/** ISO timestamp of the moment the write committed. */
	at: string;
	scope?: RealtimeScope;
	projectId?: string;
	organizationId?: string;
	userId?: string;
	data: T;
};

/** Build a project envelope. Always server side: id and clock are authoritative. */
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
		scope: "project",
		projectId,
		data,
	};
}

/** Build a personal envelope for one user in one workspace. */
export function createUserRealtimeEnvelope<T>(
	organizationId: string,
	userId: string,
	type: RealtimeEventType,
	data: T,
): RealtimeEnvelope<T> {
	return {
		v: REALTIME_PROTOCOL_VERSION,
		id: randomUUID(),
		type,
		at: new Date().toISOString(),
		scope: "user",
		organizationId,
		userId,
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
	| { type: "typing.stop"; milestoneId: string }
	| { type: "dm.typing.start"; conversationId: string }
	| { type: "dm.typing.stop"; conversationId: string };

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

	// A conversation frame names a conversation the server re-checks before it
	// relays anything, so a forged id can only waste one lookup.
	if (type === "dm.typing.start" || type === "dm.typing.stop") {
		const conversationId = record.conversationId;

		if (
			typeof conversationId !== "string" ||
			conversationId.length === 0 ||
			conversationId.length > MILESTONE_ID_MAX
		) {
			return null;
		}

		return { type, conversationId };
	}

	return null;
}

/**
 * Validate an envelope that crossed Redis.
 *
 * Redis is outside TypeScript, and the subscriber must never forward a
 * malformed or foreign payload to a topic. A project envelope needs a project
 * id. A user envelope needs both the organization and the person, because the
 * topic is derived from both.
 */
export function parseRealtimeEnvelope(value: unknown): RealtimeEnvelope | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;

	const record = value as Record<string, unknown>;

	if (record.v !== REALTIME_PROTOCOL_VERSION) return null;
	if (typeof record.id !== "string") return null;
	if (typeof record.type !== "string") return null;
	if (typeof record.at !== "string") return null;
	if (
		record.scope !== undefined &&
		record.scope !== "project" &&
		record.scope !== "user"
	) {
		return null;
	}

	if (record.scope === "user") {
		if (
			typeof record.organizationId !== "string" ||
			record.organizationId.length === 0 ||
			typeof record.userId !== "string" ||
			record.userId.length === 0
		) {
			return null;
		}

		return record as RealtimeEnvelope;
	}

	if (typeof record.projectId !== "string" || record.projectId.length === 0) {
		return null;
	}

	return record as RealtimeEnvelope;
}
