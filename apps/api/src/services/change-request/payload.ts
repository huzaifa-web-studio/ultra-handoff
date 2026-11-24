/**
 * Change request row mapping and loaders.
 *
 * Why this file: the list, the detail and every write response build the same
 * row from the same lookups. Mapping it once keeps those surfaces identical.
 *
 * Used by: the read and write modules in `services/change-request/`.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
	type ChangeRequestStatus,
	canEditChangeRequest,
	canWithdrawChangeRequest,
	isChangeRequestStatus,
} from "../../auth/change-request-permissions";
import { changeRequest, milestone, milestoneScopeEntry } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { loadUserMap } from "../project";
import { emptyCounts } from "./access";
import type {
	ChangeRequestPerson,
	ChangeRequestRecord,
	ChangeRequestRow,
} from "./types";

/** Map one row into the wire shape. */
export function toChangeRequestRow(
	record: ChangeRequestRecord,
	people: Map<string, { name: string; email: string; image: string | null }>,
	targetTitles: Map<string, string>,
	scopeEntryIds: Map<string, string>,
	viewerId: string,
): ChangeRequestRow {
	const status = record.status as ChangeRequestStatus;

	const person = (id: string | null): ChangeRequestPerson | null => {
		if (!id) return null;

		const profile = people.get(id);

		return {
			id,
			name: profile?.name || profile?.email || "Former member",
			image: profile?.image ?? null,
		};
	};

	return {
		id: record.id,
		projectId: record.projectId,
		milestoneId: record.milestoneId,
		title: record.title,
		body: record.body,
		status,
		requestedBy: person(record.requestedBy),
		decidedBy: person(record.decidedBy),
		decidedAt: record.decidedAt ? record.decidedAt.toISOString() : null,
		decisionNote: record.decisionNote,
		targetMilestoneId: record.targetMilestoneId,
		targetMilestoneTitle: record.targetMilestoneId
			? (targetTitles.get(record.targetMilestoneId) ?? null)
			: null,
		scopeEntryId: scopeEntryIds.get(record.id) ?? null,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
		canEdit: canEditChangeRequest({
			viewerId,
			requestedBy: record.requestedBy,
			status,
		}),
		canWithdraw: canWithdrawChangeRequest({
			viewerId,
			requestedBy: record.requestedBy,
			status,
		}),
	};
}

/** Resolve the titles of the milestones a page of requests points at. */
export async function loadTargetTitles(
	tx: TenantTx,
	tenant: TenantContext,
	records: ChangeRequestRecord[],
): Promise<Map<string, string>> {
	const ids = [
		...new Set(
			records
				.map((record) => record.targetMilestoneId)
				.filter((id): id is string => Boolean(id)),
		),
	];

	if (ids.length === 0) return new Map();

	const rows = await tx
		.select({ id: milestone.id, title: milestone.title })
		.from(milestone)
		.where(
			and(
				eq(milestone.organizationId, tenant.organizationId),
				inArray(milestone.id, ids),
			),
		);

	return new Map(rows.map((row) => [row.id, row.title]));
}

/**
 * Resolve the scope section each accepted request created.
 *
 * One grouped query for the whole list. The link lives on the section rather
 * than on the request, so there is still a single source of truth for the
 * accepted text.
 */
export async function loadScopeEntryIds(
	tx: TenantTx,
	tenant: TenantContext,
	records: ChangeRequestRecord[],
): Promise<Map<string, string>> {
	const ids = records.map((record) => record.id);

	if (ids.length === 0) return new Map();

	const rows = await tx
		.select({
			changeRequestId: milestoneScopeEntry.changeRequestId,
			id: milestoneScopeEntry.id,
		})
		.from(milestoneScopeEntry)
		.where(
			and(
				eq(milestoneScopeEntry.organizationId, tenant.organizationId),
				inArray(milestoneScopeEntry.changeRequestId, ids),
			),
		);

	return new Map(
		rows
			.filter(
				(row): row is { changeRequestId: string; id: string } =>
					row.changeRequestId !== null,
			)
			.map((row) => [row.changeRequestId, row.id]),
	);
}

/** Load the names for every person attached to a set of requests. */
export async function loadPeople(
	records: ChangeRequestRecord[],
): Promise<Map<string, { name: string; email: string; image: string | null }>> {
	const ids = [
		...new Set(
			records
				.flatMap((record) => [record.requestedBy, record.decidedBy])
				.filter((id): id is string => Boolean(id)),
		),
	];

	return loadUserMap(ids);
}

/** Count the requests of one milestone by status. */
export async function loadCounts(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
): Promise<Record<ChangeRequestStatus, number>> {
	const rows = await tx
		.select({
			status: changeRequest.status,
			count: sql<number>`count(*)`.mapWith(Number),
		})
		.from(changeRequest)
		.where(
			and(
				eq(changeRequest.organizationId, tenant.organizationId),
				eq(changeRequest.milestoneId, milestoneId),
			),
		)
		.groupBy(changeRequest.status);

	const counts = emptyCounts();

	for (const row of rows) {
		if (isChangeRequestStatus(row.status)) {
			counts[row.status] = row.count;
		}
	}

	return counts;
}

/** Build the wire row plus the current open count in one transaction. */
export async function toWriteShape(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	record: ChangeRequestRecord,
): Promise<{ changeRequest: ChangeRequestRow; openCount: number }> {
	const [people, targetTitles, scopeEntryIds, counts] = await Promise.all([
		loadPeople([record]),
		loadTargetTitles(tx, tenant, [record]),
		loadScopeEntryIds(tx, tenant, [record]),
		loadCounts(tx, tenant, milestoneId),
	]);

	return {
		changeRequest: toChangeRequestRow(
			record,
			people,
			targetTitles,
			scopeEntryIds,
			tenant.userId,
		),
		openCount: counts.open,
	};
}
