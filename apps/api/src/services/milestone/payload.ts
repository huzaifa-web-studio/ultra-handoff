/**
 * Milestone read payload mapping.
 *
 * Why this file: the list, the detail pane and every write response return the
 * same summary and detail shapes. Building them in one place keeps the list and
 * the detail consistent and keeps the user lookups batched per page.
 *
 * Payload split: the list returns the summary fields, the detail adds the full
 * Plate value. A rich text document can be large, and listing 25 of them would
 * make the pane feel slow for no benefit.
 *
 * Used by: `list.ts`, `create.ts`, `update.ts`, `set-assignees.ts`,
 * `lock.ts` and `checklist.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { MilestoneStatus } from "../../auth/milestone-permissions";
import { changeRequest } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { collectMentionKeys } from "../../lib/mentions";
import type { TenantContext } from "../../middleware/tenant";
import { loadPhaseSummary } from "../milestone-phase.service";
import { loadScopeEntries } from "../milestone-scope.service";
import type { ProjectAccess } from "../project.service";
import { loadUserMap } from "../project.service";
import { requireMilestoneRecord, toViewer } from "./access";
import { loadAssignees } from "./assignees";
import type {
	MilestoneAssigneeRow,
	MilestoneDetailResult,
	MilestoneRecord,
	MilestoneSummary,
} from "./types";

/**
 * Read a `date` column as the ISO day the client expects.
 *
 * Drizzle returns a string for `date`, but the helper keeps the mapping in one
 * place in case the column mode ever changes to `Date`.
 */
export function toIsoDay(value: string | Date | null): string | null {
	if (value == null) return null;

	if (value instanceof Date) return value.toISOString().slice(0, 10);

	return value;
}

/** The user ids mentioned in one rich text body. */
export function mentionedUserIds(body: unknown[]): Set<string> {
	return new Set(
		collectMentionKeys(body)
			.filter((mention) => mention.type === "user")
			.map((mention) => mention.id),
	);
}

/**
 * Resolve the display names for the people who created, last edited or locked
 * rows. One lookup for the whole page, never one per row.
 */
async function loadEditorNames(
	records: MilestoneRecord[],
): Promise<Map<string, string>> {
	const userIds = [
		...new Set(
			records
				.flatMap((record) => [
					record.createdBy,
					record.updatedBy,
					record.lockedBy,
				])
				.filter((id): id is string => Boolean(id)),
		),
	];

	if (userIds.length === 0) return new Map();

	const people = await loadUserMap(userIds);
	const names = new Map<string, string>();

	for (const [id, person] of people) {
		names.set(id, person.name || person.email || "Someone");
	}

	return names;
}

/** Map a database row into the list shape. */
function toSummary(
	record: MilestoneRecord,
	assignees: MilestoneAssigneeRow[],
	names: Map<string, string>,
	openChangeRequestCount: number,
): MilestoneSummary {
	return {
		id: record.id,
		projectId: record.projectId,
		title: record.title,
		status: record.status as MilestoneStatus,
		startDate: toIsoDay(record.startDate),
		dueDate: toIsoDay(record.dueDate),
		estimateMinutes: record.estimateMinutes,
		assignees,
		lockedAt: record.lockedAt ? record.lockedAt.toISOString() : null,
		lockedByName: record.lockedBy ? (names.get(record.lockedBy) ?? null) : null,
		openChangeRequestCount,
		completedAt: record.completedAt ? record.completedAt.toISOString() : null,
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

/**
 * Count the open change requests for a set of milestones in one query.
 *
 * Why grouped: the list needs the count per row for the Overview summary and
 * the Changes tab badge. One query for the whole page avoids the N+1 that a
 * per row count would create.
 */
async function loadOpenChangeRequestCounts(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneIds: string[],
): Promise<Map<string, number>> {
	if (milestoneIds.length === 0) return new Map();

	const rows = await tx
		.select({
			milestoneId: changeRequest.milestoneId,
			count: sql<number>`count(*)`.mapWith(Number),
		})
		.from(changeRequest)
		.where(
			and(
				eq(changeRequest.organizationId, tenant.organizationId),
				inArray(changeRequest.milestoneId, milestoneIds),
				eq(changeRequest.status, "open"),
			),
		)
		.groupBy(changeRequest.milestoneId);

	return new Map(rows.map((row) => [row.milestoneId, row.count]));
}

/** Map a set of records into summaries with assignees attached. */
export async function toSummaries(
	tx: TenantTx,
	tenant: TenantContext,
	records: MilestoneRecord[],
): Promise<MilestoneSummary[]> {
	const milestoneIds = records.map((record) => record.id);
	const [assignees, names, openCounts] = await Promise.all([
		loadAssignees(tx, tenant, milestoneIds),
		loadEditorNames(records),
		loadOpenChangeRequestCounts(tx, tenant, milestoneIds),
	]);

	return records.map((record) =>
		toSummary(
			record,
			assignees.get(record.id) ?? [],
			names,
			openCounts.get(record.id) ?? 0,
		),
	);
}

/** Load one milestone as a detail payload. */
export async function loadDetail(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	access: ProjectAccess,
): Promise<MilestoneDetailResult> {
	const record = await requireMilestoneRecord(
		tx,
		tenant,
		projectId,
		milestoneId,
	);
	const [summary, scopeEntries, phase] = await Promise.all([
		toSummaries(tx, tenant, [record]).then((rows) => rows[0]),
		loadScopeEntries(tx, tenant, record.id),
		loadPhaseSummary(tx, tenant, record.id),
	]);

	if (!summary) {
		throw new APIError("NOT_FOUND", {
			message: "That milestone no longer exists.",
		});
	}

	return {
		projectId,
		milestone: {
			...summary,
			description: record.description,
			scopeEntries,
			phase,
		},
		viewer: toViewer(tenant, access, record.status),
	};
}
