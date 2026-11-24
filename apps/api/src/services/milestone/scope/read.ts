/**
 * Read scope sections.
 *
 * Why this file: the milestone detail needs metadata for every section and the
 * editor needs one full body. The two reads stay together so the body is never
 * pulled into the list by accident.
 *
 * Used by: `services/milestone/` and `routes/milestones.ts`.
 */

import { APIError } from "better-auth/api";
import { and, asc, eq, sql } from "drizzle-orm";
import { milestoneScopeEntry } from "../../../db/schema";
import { type TenantTx, withTenant } from "../../../db/tenant";
import type { TenantContext } from "../../../middleware/tenant";
import { requireMilestoneRecord, requireProjectAccess } from "./access";
import { findEntryRecord, loadNames, toEntry, toSummary } from "./payload";
import type { MilestoneScopeEntry, MilestoneScopeEntrySummary } from "./types";

/** Every section of one milestone, oldest first, without bodies. */
export async function loadScopeEntries(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
): Promise<MilestoneScopeEntrySummary[]> {
	const rows = await tx
		.select({
			id: milestoneScopeEntry.id,
			kind: milestoneScopeEntry.kind,
			round: milestoneScopeEntry.round,
			title: milestoneScopeEntry.title,
			changeRequestId: milestoneScopeEntry.changeRequestId,
			statusPeriodId: milestoneScopeEntry.statusPeriodId,
			createdBy: milestoneScopeEntry.createdBy,
			updatedBy: milestoneScopeEntry.updatedBy,
			createdAt: milestoneScopeEntry.createdAt,
			updatedAt: milestoneScopeEntry.updatedAt,
			hasBody:
				sql<boolean>`jsonb_array_length(${milestoneScopeEntry.body}) > 0`.as(
					"scope_has_body",
				),
		})
		.from(milestoneScopeEntry)
		.where(
			and(
				eq(milestoneScopeEntry.organizationId, tenant.organizationId),
				eq(milestoneScopeEntry.milestoneId, milestoneId),
			),
		)
		.orderBy(asc(milestoneScopeEntry.createdAt), asc(milestoneScopeEntry.id));

	const names = await loadNames(rows);

	return rows.map((row) => toSummary(row, names, row.hasBody));
}

/** One section including its full editor document. */
export async function getMilestoneScopeEntry(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	entryId: string,
): Promise<MilestoneScopeEntry> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await requireProjectAccess(tx, tenant, projectId);
			const record = await requireMilestoneRecord(
				tx,
				tenant,
				projectId,
				milestoneId,
			);
			const entry = await findEntryRecord(tx, tenant, record.id, entryId);

			if (!entry) {
				throw new APIError("NOT_FOUND", {
					message: "That scope section no longer exists.",
				});
			}

			return toEntry(entry);
		},
	);
}
