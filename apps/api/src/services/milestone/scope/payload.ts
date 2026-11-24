/**
 * Scope section mapping and loading.
 *
 * Why this file: the create and update paths both map a stored section to the
 * wire shape and resolve actor names, so those helpers live once.
 *
 * Used by: `create.ts`, `read.ts` and `update.ts`.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { milestoneScopeEntry } from "../../../db/schema";
import type { TenantTx } from "../../../db/tenant";
import type { TenantContext } from "../../../middleware/tenant";
import { loadUserMap } from "../../project";
import type {
	MilestoneScopeEntry,
	MilestoneScopeEntryRecord,
	MilestoneScopeEntrySummary,
	MilestoneScopeKind,
	ScopeEntrySource,
} from "./types";

/** Map a record plus a name lookup into the summary shape. */
export function toSummary(
	record: ScopeEntrySource,
	names: Map<string, string>,
	hasBody: boolean,
): MilestoneScopeEntrySummary {
	return {
		id: record.id,
		kind: record.kind as MilestoneScopeKind,
		round: record.round,
		title: record.title,
		hasBody,
		changeRequestId: record.changeRequestId,
		statusPeriodId: record.statusPeriodId,
		createdBy: record.createdBy,
		createdByName: record.createdBy
			? (names.get(record.createdBy) ?? null)
			: null,
		updatedBy: record.updatedBy,
		updatedByName: record.updatedBy
			? (names.get(record.updatedBy) ?? null)
			: null,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

/** Resolve the display names for a set of records in one lookup. */
export async function loadNames(
	records: { createdBy: string | null; updatedBy: string | null }[],
): Promise<Map<string, string>> {
	const ids = [
		...new Set(
			records
				.flatMap((record) => [record.createdBy, record.updatedBy])
				.filter((id): id is string => Boolean(id)),
		),
	];

	if (ids.length === 0) return new Map();

	const people = await loadUserMap(ids);
	const names = new Map<string, string>();

	for (const [id, person] of people) {
		names.set(id, person.name || person.email || "Someone");
	}

	return names;
}

/** One section inside a milestone, or null. */
export async function findEntryRecord(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	entryId: string,
): Promise<MilestoneScopeEntryRecord | null> {
	const [row] = await tx
		.select()
		.from(milestoneScopeEntry)
		.where(
			and(
				eq(milestoneScopeEntry.organizationId, tenant.organizationId),
				eq(milestoneScopeEntry.milestoneId, milestoneId),
				eq(milestoneScopeEntry.id, entryId),
			),
		)
		.limit(1);

	return row ?? null;
}

/**
 * Insert one section inside an existing transaction.
 *
 * The scope rules do not run here: callers have already decided that this write
 * is allowed.
 */
export async function insertScopeEntry(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		kind: MilestoneScopeKind;
		round: number | null;
		title: string;
		body: unknown[];
		bodyText: string;
		changeRequestId?: string | null;
		statusPeriodId?: string | null;
	},
): Promise<MilestoneScopeEntryRecord> {
	const [row] = await tx
		.insert(milestoneScopeEntry)
		.values({
			id: randomUUID(),
			organizationId: tenant.organizationId,
			projectId: input.projectId,
			milestoneId: input.milestoneId,
			kind: input.kind,
			round: input.round,
			title: input.title,
			body: input.body,
			bodyText: input.bodyText,
			changeRequestId: input.changeRequestId ?? null,
			statusPeriodId: input.statusPeriodId ?? null,
			createdBy: tenant.userId,
			updatedBy: tenant.userId,
		})
		.returning();

	if (!row) {
		throw new Error("Could not create the scope section.");
	}

	return row;
}

/** The wire shape of a freshly inserted or updated section, with its body. */
export async function toEntry(
	record: MilestoneScopeEntryRecord,
): Promise<MilestoneScopeEntry> {
	const names = await loadNames([record]);

	return {
		...toSummary(record, names, record.body.length > 0),
		body: record.body,
	};
}
