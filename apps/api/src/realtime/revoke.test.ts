/**
 * Membership revocation.
 *
 * Why these matter: a revocation is the only thing that stops a removed member
 * from streaming a project. A predicate that is too broad closes a bystander's
 * socket, and one that is too narrow leaves the removed member connected.
 *
 * Run with: bun test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
	type RealtimeConnection,
	type RealtimeSocketHandle,
	realtimeRegistry,
} from "./registry";
import { applyRevocation } from "./revoke";

/** A socket that records the close call for the assertion. */
function createSocket(calls: Array<{ code?: number; reason?: string }>) {
	return {
		ping: () => undefined,
		close: (code?: number, reason?: string) => calls.push({ code, reason }),
		terminate: () => undefined,
	} satisfies RealtimeSocketHandle;
}

/** Register one connection with only the fields a test cares about. */
function addConnection(
	id: string,
	overrides: Partial<RealtimeConnection> = {},
): { calls: Array<{ code?: number; reason?: string }> } {
	const calls: Array<{ code?: number; reason?: string }> = [];
	const now = Date.now();

	realtimeRegistry.add({
		id,
		userId: "user-1",
		organizationId: "org-1",
		projectId: "project-1",
		connectedAt: now,
		lastSeenAt: now,
		lastPongAt: now,
		milestones: new Set<string>(),
		windowStartedAt: now,
		windowFrames: 0,
		socket: createSocket(calls),
		...overrides,
	});

	return { calls };
}

describe("applyRevocation", () => {
	beforeEach(() => {
		realtimeRegistry.clear();
	});

	afterEach(() => {
		realtimeRegistry.clear();
	});

	test("closes every project stream for an organization wide revocation", () => {
		const first = addConnection("a", { projectId: "project-1" });
		const second = addConnection("b", { projectId: "project-2" });
		const otherUser = addConnection("c", { userId: "user-2" });
		const otherOrg = addConnection("d", {
			userId: "user-1",
			organizationId: "org-2",
		});

		const count = applyRevocation({
			type: "revoke.member",
			organizationId: "org-1",
			userId: "user-1",
		});

		expect(count).toBe(2);
		expect(first.calls).toEqual([{ code: 4403, reason: "membership revoked" }]);
		expect(second.calls).toEqual([
			{ code: 4403, reason: "membership revoked" },
		]);
		expect(otherUser.calls).toHaveLength(0);
		expect(otherOrg.calls).toHaveLength(0);
		expect(realtimeRegistry.size).toBe(2);
	});

	test("leaves the user's other projects alone on a project scoped revocation", () => {
		const removed = addConnection("a", { projectId: "project-1" });
		const kept = addConnection("b", { projectId: "project-2" });

		const count = applyRevocation({
			type: "revoke.member",
			organizationId: "org-1",
			userId: "user-1",
			projectId: "project-1",
		});

		expect(count).toBe(1);
		expect(removed.calls).toHaveLength(1);
		expect(kept.calls).toHaveLength(0);
		expect(realtimeRegistry.get("b")).not.toBeNull();
	});
});
