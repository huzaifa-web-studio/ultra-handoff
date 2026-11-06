/**
 * Registry tests.
 *
 * Why these matter: every later feature trusts the registry to answer "who is
 * connected to this project" and "who is looking at this milestone". A stale
 * index entry would leak a presence avatar, and a missing cleanup would keep a
 * dead socket until the process restarts.
 */

import { describe, expect, it } from "bun:test";

import {
	createRealtimeRegistry,
	type RealtimeConnection,
	type RealtimeSocketHandle,
} from "./registry";

/** A socket that records nothing; the registry only calls ping and close. */
function createSocket(): RealtimeSocketHandle {
	return {
		ping: () => undefined,
		close: () => undefined,
		terminate: () => undefined,
	};
}

/** One connection with sane defaults so a test only states what it changes. */
function createConnection(
	overrides: Partial<RealtimeConnection> = {},
): RealtimeConnection {
	const now = Date.now();

	return {
		id: "connection-1",
		userId: "user-1",
		organizationId: "org-1",
		projectId: "project-1",
		connectedAt: now,
		lastSeenAt: now,
		lastPongAt: now,
		milestones: new Set<string>(),
		windowStartedAt: now,
		windowFrames: 0,
		socket: createSocket(),
		...overrides,
	};
}

describe("RealtimeRegistry", () => {
	it("indexes a connection by id and project", () => {
		const registry = createRealtimeRegistry();
		const connection = createConnection();

		registry.add(connection);

		expect(registry.size).toBe(1);
		expect(registry.projectConnections("project-1")).toHaveLength(1);
		expect(registry.get(connection.id)).toBe(connection);
		expect(registry.get("missing")).toBeNull();
	});

	it("keeps projects apart", () => {
		const registry = createRealtimeRegistry();

		registry.add(createConnection({ id: "a", projectId: "project-1" }));
		registry.add(createConnection({ id: "b", projectId: "project-2" }));

		expect(registry.projectConnections("project-1")).toHaveLength(1);
		expect(registry.projectConnections("project-2")).toHaveLength(1);
		expect(registry.projectConnections("project-3")).toHaveLength(0);
	});

	it("removes every index entry when a connection closes", () => {
		const registry = createRealtimeRegistry();
		const connection = createConnection();

		registry.add(connection);
		registry.subscribeMilestone(connection.id, "milestone-1");

		registry.remove(connection.id);

		expect(registry.size).toBe(0);
		expect(registry.projectConnections("project-1")).toHaveLength(0);
		expect(
			registry.milestoneConnections("project-1", "milestone-1"),
		).toHaveLength(0);
		expect(registry.get(connection.id)).toBeNull();
	});

	it("treats a repeated remove as a no-op", () => {
		const registry = createRealtimeRegistry();
		const connection = createConnection();

		registry.add(connection);
		registry.remove(connection.id);

		expect(() => registry.remove(connection.id)).not.toThrow();
	});

	it("joins and leaves a milestone idempotently", () => {
		const registry = createRealtimeRegistry();
		const connection = createConnection();

		registry.add(connection);

		expect(registry.subscribeMilestone(connection.id, "milestone-1")).toBe(
			true,
		);
		expect(registry.subscribeMilestone(connection.id, "milestone-1")).toBe(
			true,
		);
		expect(
			registry.milestoneConnections("project-1", "milestone-1"),
		).toHaveLength(1);

		expect(registry.unsubscribeMilestone(connection.id, "milestone-1")).toBe(
			true,
		);
		expect(registry.unsubscribeMilestone(connection.id, "milestone-1")).toBe(
			true,
		);
		expect(
			registry.milestoneConnections("project-1", "milestone-1"),
		).toHaveLength(0);
	});

	it("scopes milestone lookups to one project", () => {
		const registry = createRealtimeRegistry();

		registry.add(createConnection({ id: "a", projectId: "project-1" }));
		registry.add(createConnection({ id: "b", projectId: "project-2" }));

		registry.subscribeMilestone("a", "milestone-1");
		registry.subscribeMilestone("b", "milestone-1");

		expect(
			registry.milestoneConnections("project-1", "milestone-1"),
		).toHaveLength(1);
		expect(
			registry.milestoneConnections("project-2", "milestone-1"),
		).toHaveLength(1);
	});

	it("ignores a milestone join from an unknown connection", () => {
		const registry = createRealtimeRegistry();

		expect(registry.subscribeMilestone("missing", "milestone-1")).toBe(false);
		expect(registry.unsubscribeMilestone("missing", "milestone-1")).toBe(false);
	});

	it("updates the liveness timestamps", () => {
		const registry = createRealtimeRegistry();
		const connection = createConnection({ lastPongAt: 1, lastSeenAt: 1 });

		registry.add(connection);
		registry.touchPong(connection.id, 5_000);

		expect(connection.lastPongAt).toBe(5_000);
		expect(connection.lastSeenAt).toBe(5_000);

		registry.touchSeen(connection.id, 6_000);

		expect(connection.lastSeenAt).toBe(6_000);
	});

	it("enforces the per second frame budget and resets the window", () => {
		const registry = createRealtimeRegistry();
		const connection = createConnection({ windowStartedAt: 0 });

		registry.add(connection);

		// Two frames in the same second against a budget of two.
		expect(registry.consumeFrame(connection.id, 2, 1_000)).toBe(true);
		expect(registry.consumeFrame(connection.id, 2, 1_100)).toBe(true);
		expect(registry.consumeFrame(connection.id, 2, 1_200)).toBe(false);

		// A new window starts one second after the first frame.
		expect(registry.consumeFrame(connection.id, 2, 2_000)).toBe(true);
	});

	it("keeps the frame budget per connection", () => {
		const registry = createRealtimeRegistry();

		registry.add(createConnection({ id: "a", windowStartedAt: 0 }));
		registry.add(createConnection({ id: "b", windowStartedAt: 0 }));

		expect(registry.consumeFrame("a", 1, 1_000)).toBe(true);
		expect(registry.consumeFrame("a", 1, 1_100)).toBe(false);
		expect(registry.consumeFrame("b", 1, 1_100)).toBe(true);
	});

	it("rejects a frame for an unknown connection", () => {
		const registry = createRealtimeRegistry();

		expect(registry.consumeFrame("missing", 5)).toBe(false);
	});
});
