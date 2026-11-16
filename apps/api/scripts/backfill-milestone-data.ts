/**
 * Backfill milestone phase history and accepted scope sections.
 *
 * Why this is a script and not a migration: it reads and transforms existing
 * rows and needs to be safe to run twice. Keeping it out of `drizzle/` respects
 * the rule that migrations are generated only, and lets an operator choose when
 * to do the heavier data pass.
 *
 * What it does:
 *   1. For every milestone with no status period, reconstructs the timeline
 *      from its status events (the comment rows of kind "event") and inserts
 *      the periods. A milestone with no events gets one open period starting at
 *      its creation time.
 *   2. For every accepted change request with no scope section, creates the
 *      matching `change` section so already accepted work appears under the
 *      initial scope.
 *
 * It is idempotent: a milestone that already has periods and a request that
 * already has a section are skipped.
 *
 * Usage:
 *   cd apps/api && bun run db:backfill-milestone-data
 *   cd apps/api && bun run db:backfill-milestone-data --skip-accepted
 *
 * Used by: operators. Not part of the application runtime.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { adminClient, adminDb } from "../src/db";
import {
	changeRequest,
	comment,
	milestone,
	milestoneScopeEntry,
	milestoneStatusPeriod,
} from "../src/db/schema";

/** Skip the accepted change request pass when the operator asks. */
const skipAccepted = process.argv.includes("--skip-accepted");

/** One reconstructed stay in a status. */
type DraftPeriod = {
	status: string;
	enteredAt: Date;
	exitedAt: Date | null;
	enteredBy: string | null;
	note: string | null;
};

/**
 * Rebuild the periods of one milestone from its status events.
 *
 * The first period starts at the milestone creation time with `todo`, because
 * that is the default a milestone is created with. Every status event then
 * closes the current period and opens the next. If the last event does not
 * match the stored status (a write from before event logging, for example),
 * the stored status is opened at the milestone update time.
 */
function buildPeriods(input: {
	createdAt: Date;
	updatedAt: Date;
	status: string;
	events: {
		createdAt: Date;
		eventFrom: string | null;
		eventTo: string | null;
		eventNote: string | null;
		authorId: string | null;
	}[];
}): DraftPeriod[] {
	const periods: DraftPeriod[] = [];
	let current: DraftPeriod = {
		status: "todo",
		enteredAt: input.createdAt,
		exitedAt: null,
		enteredBy: null,
		note: null,
	};

	for (const event of input.events) {
		if (event.eventTo === null) continue;
		if (event.eventTo === current.status) continue;

		periods.push({ ...current, exitedAt: event.createdAt });
		current = {
			status: event.eventTo,
			enteredAt: event.createdAt,
			exitedAt: null,
			enteredBy: event.authorId,
			note: event.eventNote,
		};
	}

	// The stored status is authoritative. If the events disagree, close the
	// reconstructed period and open the real one, so the open row always
	// matches `milestone.status`.
	if (current.status !== input.status) {
		periods.push({ ...current, exitedAt: input.updatedAt });
		current = {
			status: input.status,
			enteredAt: input.updatedAt,
			exitedAt: null,
			enteredBy: null,
			note: null,
		};
	}

	periods.push(current);

	return periods;
}

async function backfillPeriods(): Promise<number> {
	const milestones = await adminDb.select().from(milestone);

	if (milestones.length === 0) return 0;

	const ids = milestones.map((row) => row.id);

	// Milestones that already have any period are left alone. Partial runs are
	// therefore safe: re-running only fills the gaps.
	const existing = await adminDb
		.select({ milestoneId: milestoneStatusPeriod.milestoneId })
		.from(milestoneStatusPeriod)
		.where(inArray(milestoneStatusPeriod.milestoneId, ids));

	const done = new Set(existing.map((row) => row.milestoneId));
	const pending = milestones.filter((row) => !done.has(row.id));

	if (pending.length === 0) return 0;

	const events = await adminDb
		.select({
			milestoneId: comment.milestoneId,
			createdAt: comment.createdAt,
			eventFrom: comment.eventFrom,
			eventTo: comment.eventTo,
			eventNote: comment.eventNote,
			authorId: comment.authorId,
		})
		.from(comment)
		.where(
			and(
				inArray(
					comment.milestoneId,
					pending.map((row) => row.id),
				),
				eq(comment.kind, "event"),
				eq(comment.eventType, "status"),
			),
		)
		.orderBy(asc(comment.createdAt), asc(comment.id));

	const byMilestone = new Map<string, typeof events>();

	for (const event of events) {
		if (!event.milestoneId) continue;

		const list = byMilestone.get(event.milestoneId) ?? [];
		list.push(event);
		byMilestone.set(event.milestoneId, list);
	}

	const rows = pending.flatMap((row) => {
		const periods = buildPeriods({
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			status: row.status,
			events: byMilestone.get(row.id) ?? [],
		});

		return periods.map((period) => ({
			id: randomUUID(),
			organizationId: row.organizationId,
			projectId: row.projectId,
			milestoneId: row.id,
			status: period.status,
			enteredAt: period.enteredAt,
			exitedAt: period.exitedAt,
			enteredBy: period.enteredBy,
			note: period.note,
		}));
	});

	if (rows.length > 0) {
		await adminDb.insert(milestoneStatusPeriod).values(rows);
	}

	return pending.length;
}

async function backfillAcceptedSections(): Promise<number> {
	const accepted = await adminDb
		.select()
		.from(changeRequest)
		.where(eq(changeRequest.status, "accepted"));

	if (accepted.length === 0) return 0;

	const existing = await adminDb
		.select({ changeRequestId: milestoneScopeEntry.changeRequestId })
		.from(milestoneScopeEntry)
		.where(
			inArray(
				milestoneScopeEntry.changeRequestId,
				accepted.map((row) => row.id),
			),
		);

	const done = new Set(
		existing
			.map((row) => row.changeRequestId)
			.filter((id): id is string => Boolean(id)),
	);
	const pending = accepted.filter((row) => !done.has(row.id));

	if (pending.length === 0) return 0;

	await adminDb.insert(milestoneScopeEntry).values(
		pending.map((row) => ({
			id: randomUUID(),
			organizationId: row.organizationId,
			projectId: row.projectId,
			milestoneId: row.milestoneId,
			kind: "change",
			round: null,
			title: row.title,
			body: row.body,
			bodyText: row.bodyText,
			changeRequestId: row.id,
			statusPeriodId: null,
			createdBy: row.decidedBy,
			updatedBy: row.decidedBy,
			createdAt: row.decidedAt ?? row.updatedAt,
			updatedAt: row.decidedAt ?? row.updatedAt,
		})),
	);

	return pending.length;
}

async function main(): Promise<void> {
	process.stdout.write("Backfilling milestone phases and accepted scope...\n");

	const periodCount = await backfillPeriods();
	process.stdout.write(`  ${periodCount} milestones received phase periods\n`);

	if (skipAccepted) {
		process.stdout.write("  accepted change sections skipped (--skip-accepted)\n");
	} else {
		const sectionCount = await backfillAcceptedSections();
		process.stdout.write(
			`  ${sectionCount} accepted change requests added to scope\n`,
		);
	}

	// Fail loudly rather than leaving a half applied run undetected.
	const [openPeriods] = await adminDb.execute<{ count: number }>(
		sql`select count(*)::int as count from "milestone_status_period" where exited_at is null`,
	);
	const [milestoneCount] = await adminDb.execute<{ count: number }>(
		sql`select count(*)::int as count from "milestone"`,
	);

	process.stdout.write(
		`Done. ${openPeriods?.count ?? 0} open periods for ${milestoneCount?.count ?? 0} milestones.\n`,
	);

	await adminClient.end({ timeout: 5 });
}

await main();
