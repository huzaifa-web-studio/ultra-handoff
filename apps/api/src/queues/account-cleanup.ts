/**
 * Hourly sweep for stale, unverified accounts.
 *
 * Why a queue: the sweep must keep running across deploys and restarts without
 * a person remembering to trigger it. BullMQ already backs the other background
 * work in this process, so a repeatable job is the smallest addition. The
 * scheduler is stored in Redis, so restarting the API does not reset the
 * clock.
 *
 * Why the rules live in services/account-cleanup.service.ts: this module only
 * wires the real Better Auth adapter and database reads into them, which keeps
 * the deletion decision testable.
 *
 * Used by: src/workers/index.ts and Bull Board in development.
 */

import { Worker } from "bullmq";
import { inArray } from "drizzle-orm";

import { auth } from "../auth/auth";
import { adminDb } from "../db";
import { member } from "../db/auth-schema";
import { isProduction } from "../lib/env";
import { redisConnectionOptions } from "../lib/redis";
import {
	removeStaleUnverifiedAccounts,
	type StaleAccountCleanupDeps,
} from "../services/account-cleanup.service";
import { createQueue, logQueueErrors } from "./index";

export const ACCOUNT_CLEANUP_QUEUE_NAME = "account-cleanup";

/** Registered here so Bull Board in development lists the queue. */
export const accountCleanupQueue = createQueue(ACCOUNT_CLEANUP_QUEUE_NAME);

/** One sweep per hour keeps the gap after the seven day mark small. */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Stable id so repeated boots update the scheduler instead of adding one. */
const CLEANUP_SCHEDULER_ID = "stale-unverified-accounts";

/** User ids that hold a workspace seat are never cleanup candidates. */
async function findMemberUserIds(userIds: string[]): Promise<Set<string>> {
	if (userIds.length === 0) return new Set();

	const rows = await adminDb
		.select({ userId: member.userId })
		.from(member)
		.where(inArray(member.userId, userIds));

	return new Set(rows.map((row) => row.userId));
}

/**
 * Bind the real adapters to the cleanup rules.
 *
 * The Better Auth internal adapter is used for the user query and the delete,
 * because auth tables are written through the library rather than a raw
 * business query.
 */
async function buildDeps(): Promise<StaleAccountCleanupDeps> {
	const context = await auth.$context;

	return {
		listStaleUsers: (cutoff, limit, offset) =>
			context.internalAdapter.listUsers(
				limit,
				offset,
				{ field: "createdAt", direction: "asc" },
				[
					{ field: "emailVerified", value: false },
					{ field: "createdAt", value: cutoff, operator: "lt" },
				],
			),
		findMemberUserIds,
		deleteUser: (userId) => context.internalAdapter.deleteUser(userId),
	};
}

let worker: Worker | null = null;

/** Start the in-process worker and make sure the schedule exists. */
export function startAccountCleanupWorker(): void {
	if (worker) return;

	worker = new Worker(
		ACCOUNT_CLEANUP_QUEUE_NAME,
		async () => {
			const removed = await removeStaleUnverifiedAccounts(await buildDeps());

			if (!isProduction && removed > 0) {
				console.info(
					`[account-cleanup] removed ${removed} unverified account(s)`,
				);
			}
		},
		{ connection: redisConnectionOptions, concurrency: 1 },
	);
	logQueueErrors(worker, ACCOUNT_CLEANUP_QUEUE_NAME);

	worker.on("failed", (job, error) => {
		if (!job) return;

		if (!isProduction) {
			console.error("[account-cleanup] sweep failed:", error);
		}
	});

	/**
	 * Fire and forget. A Redis outage at boot must not stop the API from
	 * starting, and the next successful boot re-creates this idempotent
	 * scheduler.
	 */
	void accountCleanupQueue
		.upsertJobScheduler(
			CLEANUP_SCHEDULER_ID,
			{ every: CLEANUP_INTERVAL_MS },
			{ name: "sweep" },
		)
		.catch((error: unknown) => {
			if (!isProduction) {
				console.error("[account-cleanup] scheduling failed:", error);
			}
		});
}

/** Close the worker and the queue on shutdown. */
export async function stopAccountCleanupWorker(): Promise<void> {
	await worker?.close();
	worker = null;
	await accountCleanupQueue.close();
}
