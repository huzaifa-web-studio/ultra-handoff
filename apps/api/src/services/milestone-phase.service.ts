/**
 * Milestone phase timing.
 *
 * Why a service: the status period rules (close the open row, open the next,
 * one open row per milestone, compute durations) have to be identical for
 * create, update and the change request flows. Keeping them here means no route
 * can change a status without leaving a timing record behind.
 *
 * The table stores `timestamptz`, so durations are exact across DST and a
 * server timezone change. Durations are computed here, in seconds, so every
 * client shows the same number regardless of its own clock.
 *
 * Used by: services/milestone.service.ts and routes/milestones.ts.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";

import type { MilestoneStatus } from "../auth/milestone-permissions";
import { milestoneStatusPeriod } from "../db/schema";
import type { TenantTx } from "../db/tenant";
import type { TenantContext } from "../middleware/tenant";

/** One recorded stay in a status. */
export type MilestonePhasePeriod = {
	id: string;
	status: MilestoneStatus;
	enteredAt: string;
	exitedAt: string | null;
	/** Whole seconds from entry to exit, or to now while the row is open. */
	durationSeconds: number;
	note: string | null;
};

/** Everything the Overview phase card needs. */
export type MilestonePhaseSummary = {
	/** The id of the open period, used to match the current scope round. */
	currentPeriodId: string | null;
	currentEnteredAt: string | null;
	currentElapsedSeconds: number;
	/** Total seconds per status, across every visit. */
	totals: Record<MilestoneStatus, number>;
	/** All periods, oldest first. */
	periods: MilestonePhasePeriod[];
};

/** A database row, before it is mapped to the wire shape. */
export type MilestoneStatusPeriodRecord =
	typeof milestoneStatusPeriod.$inferSelect;

/** Whole seconds between two instants, never negative. */
function secondsBetween(from: Date, to: Date): number {
	return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

/** An empty totals map, so a milestone with no history still has a shape. */
export function emptyPhaseTotals(): Record<MilestoneStatus, number> {
	return {
		todo: 0,
		in_development: 0,
		in_testing: 0,
		ready: 0,
		in_review: 0,
		blocked: 0,
		done: 0,
		cancelled: 0,
	};
}

/**
 * Open a period for a status.
 *
 * The caller is responsible for closing the previous open period first. The
 * partial unique index is the backstop if that is ever forgotten.
 */
export async function openStatusPeriod(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		status: MilestoneStatus;
		note?: string | null;
		enteredAt?: Date;
	},
): Promise<MilestoneStatusPeriodRecord> {
	const [row] = await tx
		.insert(milestoneStatusPeriod)
		.values({
			id: randomUUID(),
			organizationId: tenant.organizationId,
			projectId: input.projectId,
			milestoneId: input.milestoneId,
			status: input.status,
			enteredAt: input.enteredAt ?? new Date(),
			enteredBy: tenant.userId,
			note: input.note ?? null,
		})
		.returning();

	if (!row) {
		throw new Error("Could not record the milestone phase.");
	}

	return row;
}

/**
 * Close the open period of one milestone.
 *
 * Returns the closed row, or null when there was nothing open. A missing open
 * row is not an error: a milestone created before this table existed can still
 * take its first status change, and the next open call creates the row.
 */
export async function closeOpenStatusPeriod(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	at: Date = new Date(),
): Promise<MilestoneStatusPeriodRecord | null> {
	const [row] = await tx
		.update(milestoneStatusPeriod)
		.set({ exitedAt: at })
		.where(
			and(
				eq(milestoneStatusPeriod.organizationId, tenant.organizationId),
				eq(milestoneStatusPeriod.milestoneId, milestoneId),
				isNull(milestoneStatusPeriod.exitedAt),
			),
		)
		.returning();

	return row ?? null;
}

/**
 * The id of the currently open period, or null when none exists.
 *
 * The scope write rule uses this to prove a round belongs to the current visit
 * rather than merely sharing the same status name.
 */
export async function loadOpenPeriodId(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
): Promise<string | null> {
	const [row] = await tx
		.select({ id: milestoneStatusPeriod.id })
		.from(milestoneStatusPeriod)
		.where(
			and(
				eq(milestoneStatusPeriod.organizationId, tenant.organizationId),
				eq(milestoneStatusPeriod.milestoneId, milestoneId),
				isNull(milestoneStatusPeriod.exitedAt),
			),
		)
		.limit(1);

	return row?.id ?? null;
}

/**
 * Read every period of a milestone and derive the summary.
 *
 * One query, summed in JS. A milestone accumulates one row per real status
 * change, which is tens of rows at most, so an aggregate query per status would
 * be more code for no gain.
 */
export async function loadPhaseSummary(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
): Promise<MilestonePhaseSummary> {
	const rows = await tx
		.select()
		.from(milestoneStatusPeriod)
		.where(
			and(
				eq(milestoneStatusPeriod.organizationId, tenant.organizationId),
				eq(milestoneStatusPeriod.milestoneId, milestoneId),
			),
		)
		.orderBy(
			asc(milestoneStatusPeriod.enteredAt),
			asc(milestoneStatusPeriod.id),
		);

	const now = new Date();
	const totals = emptyPhaseTotals();
	let currentPeriodId: string | null = null;
	let currentEnteredAt: string | null = null;
	let currentElapsedSeconds = 0;

	const periods = rows.map((row) => {
		const exitedAt = row.exitedAt ?? now;
		const durationSeconds = secondsBetween(row.enteredAt, exitedAt);
		const status = row.status as MilestoneStatus;

		if (status in totals) totals[status] += durationSeconds;

		if (row.exitedAt === null) {
			currentPeriodId = row.id;
			currentEnteredAt = row.enteredAt.toISOString();
			currentElapsedSeconds = durationSeconds;
		}

		return {
			id: row.id,
			status,
			enteredAt: row.enteredAt.toISOString(),
			exitedAt: row.exitedAt ? row.exitedAt.toISOString() : null,
			durationSeconds,
			note: row.note,
		};
	});

	return {
		currentPeriodId,
		currentEnteredAt,
		currentElapsedSeconds,
		totals,
		periods,
	};
}
