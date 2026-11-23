/**
 * Hourly milestone reminder sweep.
 *
 * Why hourly: reminders are per person and per local day, so the worker cannot
 * run once at a single global time. Each run checks every workspace, and a
 * recipient is only eligible once their own local clock reaches 09:00.
 *
 * The scheduler lives in Redis, like the account cleanup job, so a restart or
 * deploy does not reset the clock. BullMQ gives the job to one API instance.
 *
 * Used by: src/workers/index.ts and Bull Board in development.
 */

import { Worker } from "bullmq";

import { adminDb } from "../db";
import { organization } from "../db/auth-schema";
import { withTenant } from "../db/tenant";
import { isProduction } from "../lib/env";
import { redisConnectionOptions } from "../lib/redis";
import { dispatchNotificationDeliveries } from "../services/notification-dispatch.service";
import { runReminderSweepForOrganization } from "../services/reminder.service";
import { createQueue, logQueueErrors } from "./index";

export const MILESTONE_REMINDERS_QUEUE_NAME = "milestone-reminders";

/** Registered here so Bull Board in development lists the queue. */
export const milestoneRemindersQueue = createQueue(
	MILESTONE_REMINDERS_QUEUE_NAME,
);

/** One sweep per hour. */
const REMINDER_INTERVAL_MS = 60 * 60 * 1000;

/** Stable id so a repeated boot updates the schedule instead of adding one. */
const REMINDER_SCHEDULER_ID = "milestone-due-reminders";

/**
 * A Postgres setting for the sweep, never a row value.
 *
 * The reminder inserts have no human actor, so `actor_user_id` stays null. The
 * tenant transaction still needs a non-empty user setting, and this value can
 * never match a real user id.
 */
const REMINDER_SYSTEM_USER_ID = "system:reminder";

let worker: Worker | null = null;

/** Run one sweep across every workspace. */
async function sweep(): Promise<void> {
	const organizations = await adminDb
		.select({ id: organization.id, slug: organization.slug })
		.from(organization);

	for (const item of organizations) {
		try {
			const deliveries = await withTenant(
				{
					organizationId: item.id,
					userId: REMINDER_SYSTEM_USER_ID,
				},
				(tx) =>
					runReminderSweepForOrganization(tx, {
						organizationId: item.id,
						slug: item.slug,
					}),
			);

			dispatchNotificationDeliveries(deliveries);
		} catch (error) {
			// One broken workspace must not stop the rest of the sweep.
			if (!isProduction) {
				console.error(
					`[milestone-reminders] sweep failed for ${item.id}:`,
					error,
				);
			}
		}
	}
}

/** Start the in-process worker and make sure the schedule exists. */
export function startMilestoneReminderWorker(): void {
	if (worker) return;

	worker = new Worker(
		MILESTONE_REMINDERS_QUEUE_NAME,
		async () => {
			await sweep();
		},
		{ connection: redisConnectionOptions, concurrency: 1 },
	);
	logQueueErrors(worker, MILESTONE_REMINDERS_QUEUE_NAME);

	worker.on("failed", (_job, error) => {
		if (!isProduction) {
			console.error("[milestone-reminders] sweep failed:", error);
		}
	});

	// Fire and forget. A Redis outage at boot must not stop the API from
	// starting, and the next successful boot re-creates the idempotent schedule.
	void milestoneRemindersQueue
		.upsertJobScheduler(
			REMINDER_SCHEDULER_ID,
			{ every: REMINDER_INTERVAL_MS },
			{ name: "sweep" },
		)
		.catch((error: unknown) => {
			if (!isProduction) {
				console.error("[milestone-reminders] scheduling failed:", error);
			}
		});
}

/** Close the worker and the queue on shutdown. */
export async function stopMilestoneReminderWorker(): Promise<void> {
	await worker?.close();
	worker = null;
	await milestoneRemindersQueue.close();
}
