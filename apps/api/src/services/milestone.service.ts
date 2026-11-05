/**
 * Milestone business logic.
 *
 * Why a service: the rules that matter (a milestone belongs to a project the
 * caller can see, only staff may write, an archived project is read-only,
 * assignees must be project members) must be identical for every route. They
 * live here and nowhere else.
 *
 * Shape follows `project.service.ts` on purpose:
 *   - every query runs through `withTenant`, so RLS confines it to one
 *     organization
 *   - project visibility is delegated to `loadProjectAccess`, so a milestone
 *     can never leak through a project the caller cannot open
 *   - Better Auth tables are read through `loadUserMap`, never joined inside a
 *     tenant query
 *
 * Payload split: the list returns a short `excerpt`, the detail returns the
 * full Plate value. A rich text document can be large, and listing 25 of them
 * would make the pane feel slow for no benefit.
 *
 * Used by: src/routes/milestones.ts.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { canCommentOnProject } from "../auth/comment-permissions";
import {
	ACTIVE_MILESTONE_STATUSES,
	canWriteMilestones,
	MILESTONE_ASSIGNEE_MAX,
	type MilestoneStatus,
	validateMilestoneDate,
	validateMilestoneDateRange,
	validateMilestoneEstimate,
	validateMilestoneStatus,
	validateMilestoneTitle,
} from "../auth/milestone-permissions";
import { assertProjectActive } from "../auth/project-permissions";
import {
	comment,
	milestone,
	milestoneAssignee,
	projectMember,
} from "../db/schema";
import { type TenantTx, withTenant } from "../db/tenant";
import { escapeLike } from "../lib/query";
import { sanitizeRichText } from "../lib/rich-text";
import type { TenantContext } from "../middleware/tenant";
import { queueDocumentPreviews } from "./link-preview.service";
import { listOrganizationOwners } from "./organization.service";
import {
	loadProjectAccess,
	loadUserMap,
	type ProjectAccess,
} from "./project.service";

/** Longest excerpt shown in the list. */
const EXCERPT_MAX = 180;

/** One person assigned to a milestone. */
export type MilestoneAssigneeRow = {
	userId: string;
	memberId: string;
	name: string;
	image: string | null;
};

/** One row the milestone list renders. Deliberately without the full body. */
export type MilestoneSummary = {
	id: string;
	projectId: string;
	title: string;
	excerpt: string;
	status: MilestoneStatus;
	startDate: string | null;
	dueDate: string | null;
	estimateMinutes: number | null;
	assignees: MilestoneAssigneeRow[];
	completedAt: string | null;
	createdBy: string | null;
	createdByName: string | null;
	updatedBy: string | null;
	updatedByName: string | null;
	createdAt: string;
	updatedAt: string;
};

/** The summary plus the full editor document. */
export type MilestoneDetail = MilestoneSummary & {
	description: unknown[];
};

/** Capabilities of the caller, so the UI never guesses from a role string. */
export type MilestoneViewer = {
	/** The caller's user id, so the UI can tell their own edits from another's. */
	userId: string;
	/** True when the caller may create, edit, assign and delete. */
	canWrite: boolean;
	/**
	 * True when the caller may post in the discussion.
	 *
	 * Deliberately separate from `canWrite`: a client cannot author milestones
	 * but is a full participant in the conversation about them.
	 */
	canComment: boolean;
	/** True when the project is archived and every write is refused. */
	locked: boolean;
};

/** Per status totals for the filter chips. */
export type MilestoneCounts = {
	all: number;
	active: number;
	todo: number;
	inProgress: number;
	blocked: number;
	done: number;
	cancelled: number;
};

/** Which counts key each status maps to. */
const STATUS_COUNT_KEYS: Record<MilestoneStatus, keyof MilestoneCounts> = {
	todo: "todo",
	in_progress: "inProgress",
	blocked: "blocked",
	done: "done",
	cancelled: "cancelled",
};

/** Everything the milestone tab needs in one request. */
export type MilestoneListResult = {
	organizationId: string;
	projectId: string;
	milestones: MilestoneSummary[];
	viewer: MilestoneViewer;
	counts: MilestoneCounts;
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
};

/** One milestone plus the caller's capabilities. */
export type MilestoneDetailResult = {
	projectId: string;
	milestone: MilestoneDetail;
	viewer: MilestoneViewer;
};

/** Normalised list filters, parsed and clamped by the route. */
export type MilestoneListQuery = {
	search: string;
	status: MilestoneStatus | "all" | "active";
	sort: "dueDate" | "createdAt" | "title";
	direction: "asc" | "desc";
	page: number;
	pageSize: number;
};

/** Public create input. */
export type CreateMilestoneInput = {
	title: string;
	description?: unknown;
	status?: string;
	startDate?: string | null;
	dueDate?: string | null;
	estimateMinutes?: number | null;
	assigneeUserIds?: string[];
};

/** Public update input. Every field is optional, which is what autosave sends. */
export type UpdateMilestoneInput = {
	title?: string;
	description?: unknown;
	status?: string;
	startDate?: string | null;
	dueDate?: string | null;
	estimateMinutes?: number | null;
	assigneeUserIds?: string[];
};

/** A database row, before it is mapped to the wire shape. */
export type MilestoneRecord = typeof milestone.$inferSelect;

/**
 * Read a `date` column as the ISO day the client expects.
 *
 * Drizzle returns a string for `date`, but the helper keeps the mapping in one
 * place in case the column mode ever changes to `Date`.
 */
function toIsoDay(value: string | Date | null): string | null {
	if (value == null) return null;

	if (value instanceof Date) return value.toISOString().slice(0, 10);

	return value;
}

/** One field change that belongs in the milestone timeline. */
type MilestoneEventDraft = {
	type: "status" | "start_date" | "due_date";
	from: string | null;
	to: string | null;
};

/**
 * Write activity rows into the comment timeline.
 *
 * Why the comment table instead of a second event table: the discussion is the
 * one place a reader already looks for "what changed". Storing the event as a
 * different `kind` on the same table means one ordered read serves the whole
 * timeline, with no merge step and no second cursor. Events are excluded from
 * the comment count and are never editable, so they cannot be confused with a
 * message.
 */
async function recordMilestoneEvents(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	events: MilestoneEventDraft[],
): Promise<void> {
	if (events.length === 0) return;

	await tx.insert(comment).values(
		events.map((event) => ({
			id: randomUUID(),
			organizationId: tenant.organizationId,
			milestoneId,
			authorId: tenant.userId,
			kind: "event" as const,
			eventType: event.type,
			eventFrom: event.from,
			eventTo: event.to,
			body: [],
			bodyText: "",
		})),
	);
}

/** Build the viewer capabilities from the project access the caller has. */
function toViewer(
	tenant: TenantContext,
	access: ProjectAccess,
): MilestoneViewer {
	const locked = access.row.archivedAt !== null;

	return {
		userId: tenant.userId,
		canWrite: !locked && canWriteMilestones(tenant.role, access.role),
		canComment: !locked && canCommentOnProject(tenant.role, access.role),
		locked,
	};
}

/**
 * Load the project and fail with 404 when the caller cannot see it.
 *
 * Why 404 and not 403: the project visibility rule already answers "not found"
 * for hidden projects, and reusing it means a milestone endpoint cannot be used
 * to discover that a project exists.
 */
async function requireProject(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
): Promise<ProjectAccess> {
	const access = await loadProjectAccess(tx, tenant, projectId);

	if (!access) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}

	return access;
}

/**
 * Reject a write from someone who may not write, or on a locked project.
 *
 * The archived check comes first because it is a lifecycle rule that applies to
 * every role, including owners.
 */
function assertWritable(tenant: TenantContext, access: ProjectAccess): void {
	assertProjectActive(access.row.archivedAt);

	if (!canWriteMilestones(tenant.role, access.role)) {
		throw new APIError("FORBIDDEN", {
			message: "You can review milestones but not change them.",
		});
	}
}

/** Load one milestone inside a project, or fail with 404. */
async function requireMilestoneRecord(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<MilestoneRecord> {
	const [record] = await tx
		.select()
		.from(milestone)
		.where(
			and(
				eq(milestone.organizationId, tenant.organizationId),
				eq(milestone.projectId, projectId),
				eq(milestone.id, milestoneId),
			),
		)
		.limit(1);

	if (!record) {
		throw new APIError("NOT_FOUND", {
			message: "That milestone no longer exists.",
		});
	}

	return record;
}

/**
 * Load the project access and the milestone in one call.
 *
 * Why exported: the comment service needs exactly the same two answers before
 * it may touch a thread. Sharing the helper means a comment can never be
 * reachable through a milestone the caller cannot open, and the 404 wording is
 * identical on both surfaces.
 */
export async function requireMilestoneAccess(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<{ access: ProjectAccess; milestone: MilestoneRecord }> {
	const access = await requireProject(tx, tenant, projectId);
	const record = await requireMilestoneRecord(
		tx,
		tenant,
		projectId,
		milestoneId,
	);

	return { access, milestone: record };
}

/**
 * Load the assignees for a set of milestones in one query.
 *
 * The join reads `project_member` inside the tenant query (it is a business
 * table), then names come from the privileged user lookup. This is the only
 * shape that avoids both an N+1 and a Better Auth join.
 */
async function loadAssignees(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneIds: string[],
): Promise<Map<string, MilestoneAssigneeRow[]>> {
	if (milestoneIds.length === 0) return new Map();

	const rows = await tx
		.select({
			milestoneId: milestoneAssignee.milestoneId,
			memberId: projectMember.id,
			userId: projectMember.userId,
		})
		.from(milestoneAssignee)
		.innerJoin(
			projectMember,
			eq(milestoneAssignee.projectMemberId, projectMember.id),
		)
		.where(
			and(
				eq(milestoneAssignee.organizationId, tenant.organizationId),
				inArray(milestoneAssignee.milestoneId, milestoneIds),
			),
		)
		.orderBy(asc(milestoneAssignee.createdAt));

	const people = await loadUserMap([...new Set(rows.map((row) => row.userId))]);
	const byMilestone = new Map<string, MilestoneAssigneeRow[]>();

	for (const row of rows) {
		const person = people.get(row.userId);
		const list = byMilestone.get(row.milestoneId) ?? [];

		list.push({
			userId: row.userId,
			memberId: row.memberId,
			name: person?.name || person?.email || "Former member",
			image: person?.image ?? null,
		});

		byMilestone.set(row.milestoneId, list);
	}

	// Sorted by name so the avatar stack is stable between renders.
	for (const list of byMilestone.values()) {
		list.sort((a, b) => a.name.localeCompare(b.name));
	}

	return byMilestone;
}

/**
 * Resolve the display names for the people who created and last edited rows.
 *
 * One lookup for the whole page, never one per row.
 */
async function loadEditorNames(
	records: MilestoneRecord[],
): Promise<Map<string, string>> {
	const userIds = [
		...new Set(
			records
				.flatMap((record) => [record.createdBy, record.updatedBy])
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
): MilestoneSummary {
	const excerpt = record.descriptionText.replace(/\s+/g, " ").trim();

	return {
		id: record.id,
		projectId: record.projectId,
		title: record.title,
		excerpt:
			excerpt.length > EXCERPT_MAX
				? `${excerpt.slice(0, EXCERPT_MAX)}...`
				: excerpt,
		status: record.status as MilestoneStatus,
		startDate: toIsoDay(record.startDate),
		dueDate: toIsoDay(record.dueDate),
		estimateMinutes: record.estimateMinutes,
		assignees,
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

/** Map a set of records into summaries with assignees attached. */
async function toSummaries(
	tx: TenantTx,
	tenant: TenantContext,
	records: MilestoneRecord[],
): Promise<MilestoneSummary[]> {
	const [assignees, names] = await Promise.all([
		loadAssignees(
			tx,
			tenant,
			records.map((record) => record.id),
		),
		loadEditorNames(records),
	]);

	return records.map((record) =>
		toSummary(record, assignees.get(record.id) ?? [], names),
	);
}

/**
 * Turn requested user ids into project member rows.
 *
 * Why this is not just a map: an assignee must be a member of this project.
 * Organization owners are always project owners, so an owner without a
 * materialized row (a missed sync) is repaired here rather than rejected. That
 * self heals the invariant the rest of the permission model already assumes.
 */
async function resolveAssigneeMemberIds(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	userIds: string[],
): Promise<string[]> {
	const unique = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];

	if (unique.length === 0) return [];

	if (unique.length > MILESTONE_ASSIGNEE_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: `A milestone can be assigned to at most ${MILESTONE_ASSIGNEE_MAX} people.`,
		});
	}

	const rows = await tx
		.select({ memberId: projectMember.id, userId: projectMember.userId })
		.from(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, tenant.organizationId),
				eq(projectMember.projectId, projectId),
				inArray(projectMember.userId, unique),
			),
		);

	const byUserId = new Map(rows.map((row) => [row.userId, row.memberId]));
	const missing = unique.filter((id) => !byUserId.has(id));

	if (missing.length > 0) {
		const owners = await listOrganizationOwners(tenant.organizationId);
		const ownerByUserId = new Map(owners.map((owner) => [owner.userId, owner]));

		const repairable = missing.filter((id) => ownerByUserId.has(id));

		if (repairable.length > 0) {
			await tx
				.insert(projectMember)
				.values(
					repairable.map((userId) => {
						const owner = ownerByUserId.get(userId);

						return {
							id: randomUUID(),
							organizationId: tenant.organizationId,
							projectId,
							// The owner lookup always returns a member id, so this
							// fallback is only here to satisfy the type.
							memberId: owner?.memberId ?? tenant.memberId,
							userId,
							role: "owner",
						};
					}),
				)
				.onConflictDoNothing();
		}

		// Re-read every requested id so a concurrent insert is not missed and
		// the answer reflects what is actually in the database.
		const confirmed = await tx
			.select({ memberId: projectMember.id, userId: projectMember.userId })
			.from(projectMember)
			.where(
				and(
					eq(projectMember.organizationId, tenant.organizationId),
					eq(projectMember.projectId, projectId),
					inArray(projectMember.userId, unique),
				),
			);

		const confirmedByUserId = new Map(
			confirmed.map((row) => [row.userId, row.memberId]),
		);
		const rejected = unique.filter((id) => !confirmedByUserId.has(id));

		if (rejected.length > 0) {
			const people = await loadUserMap(rejected);
			const names = rejected.map(
				(id) => people.get(id)?.name || people.get(id)?.email || "That person",
			);

			throw new APIError("BAD_REQUEST", {
				message:
					names.length === 1
						? `${names[0]} is not on this project.`
						: `${names.join(", ")} are not on this project.`,
			});
		}

		for (const [userId, memberId] of confirmedByUserId) {
			byUserId.set(userId, memberId);
		}
	}

	return unique
		.map((id) => byUserId.get(id))
		.filter((id): id is string => Boolean(id));
}

/**
 * Replace the assignee set for one milestone.
 *
 * Delete then insert inside the caller's transaction, so a failure leaves the
 * previous set untouched and the unique index makes a repeated write harmless.
 */
async function replaceAssignees(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	memberIds: string[],
): Promise<void> {
	await tx
		.delete(milestoneAssignee)
		.where(
			and(
				eq(milestoneAssignee.organizationId, tenant.organizationId),
				eq(milestoneAssignee.milestoneId, milestoneId),
			),
		);

	const unique = [...new Set(memberIds)];

	if (unique.length === 0) return;

	await tx.insert(milestoneAssignee).values(
		unique.map((projectMemberId) => ({
			id: randomUUID(),
			organizationId: tenant.organizationId,
			milestoneId,
			projectMemberId,
		})),
	);
}

/** Load one milestone as a detail payload. */
async function loadDetail(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	viewer: MilestoneViewer,
): Promise<MilestoneDetailResult> {
	const record = await requireMilestoneRecord(
		tx,
		tenant,
		projectId,
		milestoneId,
	);
	const [summary] = await toSummaries(tx, tenant, [record]);

	return {
		projectId,
		milestone: { ...summary, description: record.description },
		viewer,
	};
}

/**
 * The milestone list for one project.
 *
 * The status filter is applied to the rows and the total, while the counts are
 * computed over the search scope only. That keeps the chip numbers honest while
 * one status is selected, exactly like the projects page.
 */
export async function listMilestones(
	tenant: TenantContext,
	projectId: string,
	query: MilestoneListQuery,
): Promise<MilestoneListResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			const scope = [
				eq(milestone.organizationId, tenant.organizationId),
				eq(milestone.projectId, projectId),
			];

			const search = query.search.trim();

			if (search.length > 0) {
				const pattern = `%${escapeLike(search)}%`;
				const searchClause = or(
					ilike(milestone.title, pattern),
					ilike(milestone.descriptionText, pattern),
				);

				if (searchClause) scope.push(searchClause);
			}

			const [countsRow] = await tx
				.select({
					all: sql<number>`count(*)`.mapWith(Number),
					active:
						sql<number>`count(*) filter (where ${milestone.status} in ('todo', 'in_progress', 'blocked'))`.mapWith(
							Number,
						),
					todo: sql<number>`count(*) filter (where ${milestone.status} = 'todo')`.mapWith(
						Number,
					),
					inProgress:
						sql<number>`count(*) filter (where ${milestone.status} = 'in_progress')`.mapWith(
							Number,
						),
					blocked:
						sql<number>`count(*) filter (where ${milestone.status} = 'blocked')`.mapWith(
							Number,
						),
					done: sql<number>`count(*) filter (where ${milestone.status} = 'done')`.mapWith(
						Number,
					),
					cancelled:
						sql<number>`count(*) filter (where ${milestone.status} = 'cancelled')`.mapWith(
							Number,
						),
				})
				.from(milestone)
				.where(and(...scope));

			const counts: MilestoneCounts = countsRow ?? {
				all: 0,
				active: 0,
				todo: 0,
				inProgress: 0,
				blocked: 0,
				done: 0,
				cancelled: 0,
			};

			const total =
				query.status === "all"
					? counts.all
					: query.status === "active"
						? counts.active
						: counts[STATUS_COUNT_KEYS[query.status]];

			const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
			const page = Math.min(Math.max(1, query.page), totalPages);

			const statusFilter =
				query.status === "all"
					? undefined
					: query.status === "active"
						? inArray(milestone.status, [...ACTIVE_MILESTONE_STATUSES])
						: eq(milestone.status, query.status);

			const records = await tx
				.select()
				.from(milestone)
				.where(and(...scope, ...(statusFilter ? [statusFilter] : [])))
				.orderBy(
					...buildOrderBy(query),
					// A stable tiebreaker means paging cannot show a row twice.
					asc(milestone.id),
				)
				.limit(query.pageSize)
				.offset((page - 1) * query.pageSize);

			return {
				organizationId: tenant.organizationId,
				projectId,
				milestones: await toSummaries(tx, tenant, records),
				viewer: toViewer(tenant, access),
				counts,
				page,
				pageSize: query.pageSize,
				total,
				totalPages,
			};
		},
	);
}

/**
 * Build the ordering clause.
 *
 * Due date always sorts nulls last, in both directions, because "no date" is
 * missing information, not the earliest possible date. The direction never
 * reaches SQL as raw user input: only the two parsed literals do.
 */
function buildOrderBy(query: MilestoneListQuery) {
	const direction = query.direction === "asc" ? "asc" : "desc";
	const dir = sql.raw(direction);

	if (query.sort === "dueDate") {
		return [sql`${milestone.dueDate} ${dir} nulls last`];
	}

	if (query.sort === "title") {
		return [sql`lower(${milestone.title}) ${dir}`];
	}

	return [sql`${milestone.createdAt} ${dir}`];
}

/** One milestone with the full editor document. */
export async function getMilestone(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<MilestoneDetailResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);

			return loadDetail(
				tx,
				tenant,
				projectId,
				milestoneId,
				toViewer(tenant, access),
			);
		},
	);
}

/** Create a milestone, optionally with its first assignees. */
export async function createMilestone(
	tenant: TenantContext,
	projectId: string,
	input: CreateMilestoneInput,
): Promise<MilestoneDetailResult> {
	const title = validateMilestoneTitle(input.title);
	const status = input.status ? validateMilestoneStatus(input.status) : "todo";
	const startDate = validateMilestoneDate(input.startDate, "The start date");
	const dueDate = validateMilestoneDate(input.dueDate, "The due date");

	validateMilestoneDateRange(startDate, dueDate);

	const estimateMinutes = validateMilestoneEstimate(input.estimateMinutes);
	const description = sanitizeRichText(input.description);
	const milestoneId = randomUUID();

	const result = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertWritable(tenant, access);

			// Resolve assignees before the insert, so a bad assignee fails the
			// whole request instead of leaving a milestone behind.
			const memberIds = input.assigneeUserIds
				? await resolveAssigneeMemberIds(
						tx,
						tenant,
						projectId,
						input.assigneeUserIds,
					)
				: [];

			await tx.insert(milestone).values({
				id: milestoneId,
				organizationId: tenant.organizationId,
				projectId,
				title,
				status,
				description: description.value,
				descriptionText: description.text,
				startDate,
				dueDate,
				estimateMinutes,
				completedAt: status === "done" ? new Date() : null,
				createdBy: tenant.userId,
				updatedBy: tenant.userId,
			});

			await replaceAssignees(tx, tenant, milestoneId, memberIds);

			return loadDetail(
				tx,
				tenant,
				projectId,
				milestoneId,
				toViewer(tenant, access),
			);
		},
	);

	// Enrichment only. A queue or Redis failure must never fail the save, so
	// this runs after the transaction commits and its rejection is swallowed.
	void queueDocumentPreviews(tenant, result.milestone.description).catch(
		() => undefined,
	);

	return result;
}

/** Update any subset of fields. This is the endpoint autosave calls. */
export async function updateMilestone(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	input: UpdateMilestoneInput,
): Promise<MilestoneDetailResult> {
	const result = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertWritable(tenant, access);

			const record = await requireMilestoneRecord(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			const patch: Partial<typeof milestone.$inferInsert> = {
				updatedBy: tenant.userId,
			};
			const events: MilestoneEventDraft[] = [];

			if (input.title !== undefined) {
				patch.title = validateMilestoneTitle(input.title);
			}

			if (input.status !== undefined) {
				const status = validateMilestoneStatus(input.status);
				patch.status = status;

				if (status !== record.status) {
					events.push({ type: "status", from: record.status, to: status });
				}

				// `completed_at` is derived state. Keep it in sync here so no
				// code path can produce "done but never completed".
				if (status === "done" && record.status !== "done") {
					patch.completedAt = new Date();
				} else if (status !== "done") {
					patch.completedAt = null;
				}
			}

			if (input.description !== undefined) {
				const description = sanitizeRichText(input.description);
				patch.description = description.value;
				patch.descriptionText = description.text;
			}

			// The range check needs both sides, so a one sided patch is compared
			// against the value already stored.
			const previousStart = toIsoDay(record.startDate);
			const previousDue = toIsoDay(record.dueDate);
			const nextStart =
				input.startDate !== undefined
					? validateMilestoneDate(input.startDate, "The start date")
					: previousStart;
			const nextDue =
				input.dueDate !== undefined
					? validateMilestoneDate(input.dueDate, "The due date")
					: previousDue;

			if (input.startDate !== undefined) {
				patch.startDate = nextStart;

				if (nextStart !== previousStart) {
					events.push({
						type: "start_date",
						from: previousStart,
						to: nextStart,
					});
				}
			}

			if (input.dueDate !== undefined) {
				patch.dueDate = nextDue;

				if (nextDue !== previousDue) {
					events.push({ type: "due_date", from: previousDue, to: nextDue });
				}
			}

			validateMilestoneDateRange(nextStart, nextDue);

			if (input.estimateMinutes !== undefined) {
				patch.estimateMinutes = validateMilestoneEstimate(
					input.estimateMinutes,
				);
			}

			await tx
				.update(milestone)
				.set(patch)
				.where(
					and(
						eq(milestone.organizationId, tenant.organizationId),
						eq(milestone.projectId, projectId),
						eq(milestone.id, milestoneId),
					),
				);

			await recordMilestoneEvents(tx, tenant, milestoneId, events);

			if (input.assigneeUserIds !== undefined) {
				const memberIds = await resolveAssigneeMemberIds(
					tx,
					tenant,
					projectId,
					input.assigneeUserIds,
				);

				await replaceAssignees(tx, tenant, milestoneId, memberIds);
			}

			return loadDetail(
				tx,
				tenant,
				projectId,
				milestoneId,
				toViewer(tenant, access),
			);
		},
	);

	// Only a body change can introduce a new link. Every other patch skips the
	// queue entirely, which keeps status and date edits free.
	if (input.description !== undefined) {
		void queueDocumentPreviews(tenant, result.milestone.description).catch(
			() => undefined,
		);
	}

	return result;
}

/**
 * Replace the assignee set.
 *
 * Why its own endpoint: the picker sends the full selection, and keeping it
 * separate from the field patch means a lost assignee update can never
 * overwrite a body someone is typing.
 */
export async function setMilestoneAssignees(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	userIds: string[],
): Promise<MilestoneDetailResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertWritable(tenant, access);

			await requireMilestoneRecord(tx, tenant, projectId, milestoneId);

			const memberIds = await resolveAssigneeMemberIds(
				tx,
				tenant,
				projectId,
				userIds,
			);

			await replaceAssignees(tx, tenant, milestoneId, memberIds);

			return loadDetail(
				tx,
				tenant,
				projectId,
				milestoneId,
				toViewer(tenant, access),
			);
		},
	);
}

/**
 * Permanently delete a milestone. Assignments cascade with it.
 */
export async function deleteMilestone(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<{ status: "ok" }> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertWritable(tenant, access);

			await requireMilestoneRecord(tx, tenant, projectId, milestoneId);

			await tx
				.delete(milestone)
				.where(
					and(
						eq(milestone.organizationId, tenant.organizationId),
						eq(milestone.projectId, projectId),
						eq(milestone.id, milestoneId),
					),
				);

			return { status: "ok" as const };
		},
	);
}
