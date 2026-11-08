/**
 * Realtime event bus.
 *
 * Why Redis sits in front of Bun topics: Bun's `publish` only reaches sockets
 * on the current process. With one container that is enough, but a second API
 * replica would silently stop delivering. Redis pub/sub costs one hop and
 * makes the transport correct today and after a scale out, with no second code
 * path to maintain.
 *
 * Delivery rules:
 *   - a mutation publishes after its transaction commits, never inside it
 *   - publishing never throws, so a Redis outage cannot fail a user's save
 *   - when Redis is not ready, the event is delivered locally as a degraded
 *     single instance fallback instead of being queued and replayed stale
 *
 * Used by: realtime/index.ts (lifecycle), and the comment and milestone
 * routes (publishing).
 */

import Redis from "ioredis";
import { getRedis, redisConnectionOptions } from "../lib/redis";
import { type MemberRevocation, REALTIME_CONTROL_CHANNEL } from "./control";
import {
	createRealtimeEnvelope,
	parseRealtimeEnvelope,
	projectTopic,
	REALTIME_CHANNEL,
	type RealtimeEventType,
} from "./protocol";
import { applyRevocation, handleControlMessage } from "./revoke";

/** Local fan-out into one Bun topic. Installed by the gateway lifecycle. */
type LocalPublisher = (topic: string, payload: string) => void;

/**
 * How long a publish waits for a connecting Redis client.
 *
 * Why a bounded wait instead of an immediate fallback: the client connects
 * lazily, so the first publish after boot, or the first one after a reconnect,
 * would otherwise skip Redis and reach only the local process. A short wait
 * keeps the multi instance path correct without letting a Redis outage delay a
 * request, because publishing is fire and forget.
 */
const PUBLISH_READY_TIMEOUT_MS = 250;

let localPublisher: LocalPublisher | null = null;
let subscriber: Redis | null = null;

/** Resolve true once the client is ready, or false after the timeout. */
function waitForReady(redis: Redis, timeoutMs: number): Promise<boolean> {
	if (redis.status === "ready") return Promise.resolve(true);

	return new Promise((resolve) => {
		let settled = false;

		const finish = (value: boolean) => {
			if (settled) return;

			settled = true;
			clearTimeout(timer);
			redis.off("ready", onReady);
			resolve(value);
		};

		const onReady = () => finish(true);
		const timer = setTimeout(() => finish(redis.status === "ready"), timeoutMs);

		redis.once("ready", onReady);
	});
}

/**
 * Register the Bun publisher.
 *
 * Exported separately from `startRealtimeBus` so a unit test can capture the
 * payload without opening a Redis connection.
 */
export function setRealtimeLocalPublisher(publish: LocalPublisher): void {
	localPublisher = publish;
}

/** Hand one raw payload to the local Bun topic. */
function deliverLocally(raw: string): void {
	if (!localPublisher) return;

	let value: unknown;

	try {
		value = JSON.parse(raw);
	} catch {
		return;
	}

	const envelope = parseRealtimeEnvelope(value);

	if (!envelope) return;

	localPublisher(projectTopic(envelope.projectId), raw);
}

/**
 * Start the subscriber.
 *
 * Deliberately not awaited: ioredis queues the SUBSCRIBE while it connects.
 * Awaiting it would hang the boot sequence when Redis is temporarily down,
 * which is exactly when the HTTP server should still come up.
 */
export function startRealtimeBus(): void {
	if (subscriber) return;

	const client = new Redis(redisConnectionOptions);

	// Without an error listener, an EventEmitter error would be unhandled and
	// take the process down. A bus failure degrades realtime, not the API.
	client.on("error", () => undefined);
	client.on("message", (channel, message) => {
		// Control frames are instructions for this process, not content for a
		// browser, so they stop here instead of reaching a project topic.
		if (channel === REALTIME_CONTROL_CHANNEL) {
			handleControlMessage(message);
			return;
		}

		deliverLocally(message);
	});

	subscriber = client;

	void client
		.subscribe(REALTIME_CHANNEL, REALTIME_CONTROL_CHANNEL)
		.catch(() => undefined);
}

/** Close the subscriber. Safe to call when it never started. */
export function stopRealtimeBus(): void {
	const client = subscriber;

	subscriber = null;

	if (!client) return;

	// `quit` waits for pending replies and can hang a deploy when Redis is
	// unreachable. The subscriber has no state worth flushing.
	client.disconnect();
}

/**
 * Publish one event for one project.
 *
 * Never throws. The caller uses `void` and does not need a catch, which keeps
 * publishing out of the success path of every mutation.
 */
export async function publishRealtimeEvent<T>(
	projectId: string,
	type: RealtimeEventType,
	data: T,
): Promise<void> {
	const envelope = createRealtimeEnvelope(projectId, type, data);
	const raw = JSON.stringify(envelope);
	const redis = getRedis();

	// A connecting client is waited for briefly, so a publish during boot still
	// reaches the other instances. A client that is down or reconnecting beyond
	// the timeout falls back to a local delivery, which is honest about what
	// actually reached a socket and avoids replaying stale events later.
	if (!(await waitForReady(redis, PUBLISH_READY_TIMEOUT_MS))) {
		deliverLocally(raw);
		return;
	}

	try {
		await redis.publish(REALTIME_CHANNEL, raw);
	} catch {
		deliverLocally(raw);
	}
}

/**
 * Publish one membership revocation to every API instance.
 *
 * Follows the same degraded rule as project events: a Redis outage closes the
 * matching local sockets immediately instead of queueing a stale instruction
 * that would fire after the member was re-added.
 */
export async function publishMemberRevocation(
	revocation: MemberRevocation,
): Promise<void> {
	const redis = getRedis();

	if (!(await waitForReady(redis, PUBLISH_READY_TIMEOUT_MS))) {
		applyRevocation(revocation);
		return;
	}

	try {
		await redis.publish(REALTIME_CONTROL_CHANNEL, JSON.stringify(revocation));
	} catch {
		applyRevocation(revocation);
	}
}
