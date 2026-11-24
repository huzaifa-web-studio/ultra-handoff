/**
 * Project list, sidebar and pinning.
 *
 * Why this file: the list page and the sidebar read the same projects with
 * different filters and limits. Keeping them together means the visibility and
 * ordering rules cannot drift.
 *
 * Used by: `routes/projects.ts`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, asc, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { canCreateProject } from "../../auth/project-permissions";
import { project, projectPin } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { escapeLike } from "../../lib/query";
import type { TenantContext } from "../../middleware/tenant";
import {
	canSeeArchivedProjects,
	loadProjectAccess,
	myProjectRoleSql,
	pinnedProjectSql,
	projectVisibility,
} from "./access";
import { toProjectRow, toProjectSummary } from "./payload";
import type {
	ProjectListQuery,
	ProjectListResult,
	SidebarProjectsResult,
} from "./types";

/**
 * The projects page payload.
 *
 * Only projects the caller belongs to are counted and returned. Counts are
 * computed over the membership plus search scope, not over the status filter,
 * so the filter labels stay honest while one status is selected.
 */
export async function listProjects(
	tenant: TenantContext,
	query: ProjectListQuery,
): Promise<ProjectListResult> {
	const result = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			// A project is visible to its members. Organization owners see all
			// projects in the workspace because they are always project owners.
			const visibility = projectVisibility(tx, tenant);

			const scope: SQL[] = [
				eq(project.organizationId, tenant.organizationId),
				visibility,
			];

			const search = query.search.trim();
			if (search.length > 0) {
				const pattern = `%${escapeLike(search)}%`;
				const searchClause = or(
					ilike(project.name, pattern),
					ilike(project.slug, pattern),
				);

				if (searchClause) scope.push(searchClause);
			}

			const statusFilter =
				query.status === "active"
					? sql`${project.archivedAt} is null`
					: query.status === "archived"
						? sql`${project.archivedAt} is not null`
						: undefined;

			const [counts] = await tx
				.select({
					all: sql<number>`count(*)`.mapWith(Number),
					active:
						sql<number>`count(*) filter (where ${project.archivedAt} is null)`.mapWith(
							Number,
						),
					archived:
						sql<number>`count(*) filter (where ${project.archivedAt} is not null)`.mapWith(
							Number,
						),
				})
				.from(project)
				.where(and(...scope));

			const countValues = counts ?? { all: 0, active: 0, archived: 0 };
			const total =
				query.status === "active"
					? countValues.active
					: query.status === "archived"
						? countValues.archived
						: countValues.all;

			const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
			const page = Math.min(Math.max(1, query.page), totalPages);

			const sortColumn =
				query.sort === "name"
					? sql`lower(${project.name})`
					: query.sort === "updatedAt"
						? project.updatedAt
						: project.createdAt;

			const myRole = myProjectRoleSql(tenant);

			const memberCount = sql<number>`(select count(*) from project_member pm
				where pm.project_id = "project"."id")`.mapWith(Number);

			const rows = await tx
				.select({
					id: project.id,
					name: project.name,
					slug: project.slug,
					logo: project.logo,
					description: project.description,
					archivedAt: project.archivedAt,
					archiveVisibleToClient: project.archiveVisibleToClient,
					createdAt: project.createdAt,
					updatedAt: project.updatedAt,
					myRole,
					memberCount,
					pinned: pinnedProjectSql(tenant),
				})
				.from(project)
				.where(and(...scope, ...(statusFilter ? [statusFilter] : [])))
				.orderBy(
					query.direction === "asc" ? asc(sortColumn) : desc(sortColumn),
					asc(project.id),
				)
				.limit(query.pageSize)
				.offset((page - 1) * query.pageSize);

			return {
				rows,
				counts: countValues,
				canSeeArchived: await canSeeArchivedProjects(tx, tenant),
				page,
				total,
				totalPages,
			};
		},
	);

	return {
		organizationId: tenant.organizationId,
		projects: result.rows.map((row) => toProjectRow(row, tenant)),
		viewer: {
			organizationRole: tenant.role,
			canCreate: canCreateProject(tenant.role),
			canSeeArchived: result.canSeeArchived,
		},
		counts: result.counts,
		page: result.page,
		pageSize: query.pageSize,
		total: result.total,
		totalPages: result.totalPages,
	};
}

/**
 * Safety ceiling for the pin query. The API cap keeps real workspaces far
 * below this, but the query still returns old pins from before the cap so they
 * can be unpinned.
 */
const SIDEBAR_PIN_LIMIT = 50;

/**
 * Most projects one person can pin in one workspace.
 *
 * Why a cap: the pinned rows sit above the full list, so an unbounded set
 * would push the list out of reach. Five is enough for a working set.
 */
export const PINNED_PROJECT_LIMIT = 5;

/**
 * The sidebar payload: the caller's pinned projects.
 *
 * Every read is filtered by the same visibility rule as the projects page, so a
 * leftover pin after losing project membership exposes nothing.
 */
export async function getSidebarProjects(
	tenant: TenantContext,
): Promise<SidebarProjectsResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const pinnedRows = await tx
				.select({
					id: project.id,
					name: project.name,
					slug: project.slug,
					logo: project.logo,
					archivedAt: project.archivedAt,
					pinnedAt: projectPin.pinnedAt,
				})
				.from(projectPin)
				.innerJoin(project, eq(projectPin.projectId, project.id))
				.where(
					and(
						eq(projectPin.organizationId, tenant.organizationId),
						eq(projectPin.userId, tenant.userId),
						projectVisibility(tx, tenant),
					),
				)
				.orderBy(desc(projectPin.pinnedAt))
				.limit(SIDEBAR_PIN_LIMIT);

			return { pinned: pinnedRows.map((row) => toProjectSummary(row, true)) };
		},
	);
}

/**
 * Pin or unpin one project for the caller.
 *
 * Idempotent because it is an upsert on the unique (project, user) index. An
 * archived project cannot be newly pinned: it is finished work, and the sidebar
 * is about current attention. An existing pin is untouched by archiving.
 */
export async function setProjectPinned(
	tenant: TenantContext,
	projectId: string,
	pinned: boolean,
): Promise<{ pinned: boolean; pinnedAt: string | null }> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			if (pinned && access.row.archivedAt) {
				throw new APIError("BAD_REQUEST", {
					message: "Restore the project before pinning it.",
				});
			}

			// Unpin removes the row. A null timestamp cannot represent "not
			// pinned" because pinned_at is the row's reason to exist.
			if (!pinned) {
				await tx
					.delete(projectPin)
					.where(
						and(
							eq(projectPin.projectId, projectId),
							eq(projectPin.userId, tenant.userId),
						),
					);

				return { pinned: false, pinnedAt: null };
			}

			// A new pin is capped. Re-pinning a project that is already pinned
			// is idempotent and must not be blocked by the cap.
			if (!access.row.pinned) {
				// Serialize pin changes for this person in this workspace, so
				// two tabs cannot both see four pins and create a sixth.
				await tx.execute(
					sql`select pg_advisory_xact_lock(hashtext(${tenant.organizationId}), hashtext(${tenant.userId}))`,
				);

				const [countRow] = await tx
					.select({ count: sql<number>`count(*)`.mapWith(Number) })
					.from(projectPin)
					.where(
						and(
							eq(projectPin.organizationId, tenant.organizationId),
							eq(projectPin.userId, tenant.userId),
						),
					);

				if ((countRow?.count ?? 0) >= PINNED_PROJECT_LIMIT) {
					throw new APIError("BAD_REQUEST", {
						message: `You can pin up to ${PINNED_PROJECT_LIMIT} projects. Unpin one first.`,
					});
				}
			}

			const pinnedAt = new Date();

			await tx
				.insert(projectPin)
				.values({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					projectId,
					userId: tenant.userId,
					pinnedAt,
				})
				.onConflictDoUpdate({
					target: [projectPin.projectId, projectPin.userId],
					set: { pinnedAt, updatedAt: pinnedAt },
				});

			return { pinned: true, pinnedAt: pinnedAt.toISOString() };
		},
	);
}
