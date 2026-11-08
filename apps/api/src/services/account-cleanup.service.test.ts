/**
 * Stale unverified account cleanup rules.
 *
 * Why these exist: this job deletes real rows. Pinning the TTL, the membership
 * guard and the pagination here means a future edit cannot quietly delete a
 * workspace member or leave a stale account reserved forever.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	removeStaleUnverifiedAccounts,
	type StaleAccountCleanupDeps,
	staleAccountCutoff,
	UNVERIFIED_ACCOUNT_TTL_MS,
} from "./account-cleanup.service";

const NOW = new Date("2026-11-08T12:00:00.000Z");

/** Build dependencies that answer from a fixed candidate list. */
function makeDeps(
	candidates: { id: string }[],
	memberIds: string[] = [],
): {
	deps: StaleAccountCleanupDeps;
	listCalls: { cutoff: Date; limit: number; offset: number }[];
	deleted: string[];
} {
	const listCalls: { cutoff: Date; limit: number; offset: number }[] = [];
	const deleted: string[] = [];

	const deps: StaleAccountCleanupDeps = {
		async listStaleUsers(cutoff, limit, offset) {
			listCalls.push({ cutoff, limit, offset });
			return candidates.slice(offset, offset + limit);
		},
		async findMemberUserIds() {
			return new Set(memberIds);
		},
		async deleteUser(userId) {
			deleted.push(userId);
		},
	};

	return { deps, listCalls, deleted };
}

describe("staleAccountCutoff", () => {
	test("is exactly seven days before now", () => {
		expect(UNVERIFIED_ACCOUNT_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
		expect(staleAccountCutoff(NOW).toISOString()).toBe(
			"2026-11-01T12:00:00.000Z",
		);
	});
});

describe("removeStaleUnverifiedAccounts", () => {
	test("removes every stale user that is not a workspace member", async () => {
		const { deps, deleted } = makeDeps([{ id: "a" }, { id: "b" }]);

		await expect(removeStaleUnverifiedAccounts(deps, NOW)).resolves.toBe(2);
		expect(deleted).toEqual(["a", "b"]);
	});

	test("keeps a user who belongs to a workspace", async () => {
		const { deps, deleted } = makeDeps(
			[{ id: "keep" }, { id: "remove" }],
			["keep"],
		);

		await expect(removeStaleUnverifiedAccounts(deps, NOW)).resolves.toBe(1);
		expect(deleted).toEqual(["remove"]);
	});

	test("does nothing when there are no candidates", async () => {
		const { deps, deleted } = makeDeps([]);

		await expect(removeStaleUnverifiedAccounts(deps, NOW)).resolves.toBe(0);
		expect(deleted).toEqual([]);
	});

	test("pages through a backlog before deleting anything", async () => {
		const candidates = Array.from({ length: 250 }, (_, index) => ({
			id: `user-${index}`,
		}));
		const { deps, deleted } = makeDeps(candidates);

		await expect(removeStaleUnverifiedAccounts(deps, NOW)).resolves.toBe(250);
		expect(deleted).toHaveLength(250);
	});

	test("passes the seven day cutoff to the query", async () => {
		const { deps, listCalls } = makeDeps([{ id: "a" }]);

		await removeStaleUnverifiedAccounts(deps, NOW);

		expect(listCalls[0]?.cutoff.toISOString()).toBe("2026-11-01T12:00:00.000Z");
	});
});
