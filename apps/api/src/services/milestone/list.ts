/**
 * Milestone list and detail reads.
 *
 * Why this file: the list and the single detail read are the only read
 * endpoints on the milestone tab. They share the project visibility check, the
 * summary mapping and the viewer capabilities, so they live together.
 *
 * The status filter is applied to the rows and the total, while the counts are
 * computed over the search scope only. That keeps the chip numbers honest while
 * one status is selected, exactly like the projects page.
 *
 * Used by: `routes/milestones.ts`.
 */

import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { MilestoneStatus } from "../../auth/milestone-permissions";
import { ACTIVE_MILESTONE_STATUSES } from "../../auth/milestone-permissions";
import { milestone } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { escapeLike } from "../../lib/query";
import type { TenantContext } from "../../middleware/tenant";
import { requireProject, toViewer } from "./access";
import { loadDetail, toSummaries } from "./payload";
import type {
	MilestoneCounts,
	MilestoneDetailResult,
	MilestoneListQuery,
	MilestoneListResult,
} from "./types";

/** Which counts key each status maps to. */
const STATUS_COUNT_KEYS: Record<MilestoneStatus, keyof MilestoneCounts> = {
	todo: "todo",
	in_development: "inDevelopment",
	in_testing: "inTesting",
	ready: "ready",
	in_review: "inReview",
	blocked: "blocked",
	done: "done",
	cancelled: "cancelled",
};

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
				// Title only. Descriptions are long, project scoped and not
				// worth a trigram index for a list search, so they are not
				// matched here.
				const pattern = `%${escapeLike(search)}%`;
				scope.push(ilike(milestone.title, pattern));
			}

			const [countsRow] = await tx
				.select({
					all: sql<number>`count(*)`.mapWith(Number),
					active:
						sql<number>`count(*) filter (where ${milestone.status} in ('todo', 'in_development', 'in_testing', 'ready', 'in_review', 'blocked'))`.mapWith(
							Number,
						),
					todo: sql<number>`count(*) filter (where ${milestone.status} = 'todo')`.mapWith(
						Number,
					),
					inDevelopment:
						sql<number>`count(*) filter (where ${milestone.status} = 'in_development')`.mapWith(
							Number,
						),
					inTesting:
						sql<number>`count(*) filter (where ${milestone.status} = 'in_testing')`.mapWith(
							Number,
						),
					ready:
						sql<number>`count(*) filter (where ${milestone.status} = 'ready')`.mapWith(
							Number,
						),
					inReview:
						sql<number>`count(*) filter (where ${milestone.status} = 'in_review')`.mapWith(
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
				inDevelopment: 0,
				inTesting: 0,
				ready: 0,
				inReview: 0,
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

			return loadDetail(tx, tenant, projectId, milestoneId, access);
		},
	);
}
