/**
 * Project visibility and access.
 *
 * Why this file: a project is visible to its members and to organization
 * owners, and that rule has to answer the same way for the list, the detail
 * pane and every write. It lives here and nowhere else.
 *
 * Used by: `list.ts`, `detail.ts`, the lifecycle and member modules, and
 * `services/milestone/`.
 */

import { and, eq, exists, inArray, or, type SQL, sql } from "drizzle-orm";
import { isOrganizationOwner } from "../../auth/permissions";
import {
	canViewArchivedProject,
	effectiveProjectRole,
} from "../../auth/project-permissions";
import { project, projectMember } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import type { ProjectAccess } from "./types";

/**
 * The caller's project role as a correlated subquery.
 *
 * Shared by the visibility rule and the access loader so the two can never
 * disagree about which role the caller holds on a project.
 */
export function myProjectRoleSql(tenant: TenantContext): SQL<string | null> {
	return sql<string | null>`(select pm.role from project_member pm
		where pm.project_id = "project"."id"
		and pm.user_id = ${tenant.userId}
		limit 1)`;
}

/**
 * SQL condition that is true for the projects the caller may see.
 *
 * Organization owners see every project in the workspace because they are
 * always project owners. Everyone else needs a membership row.
 *
 * Archiving then narrows that rule: an archived project stays visible to project
 * owners and admins, and to a client only when the project opted in. A plain
 * member loses it. The condition lives here so the list, the sidebar, pin and
 * visit cannot drift apart on the two rules that decide visibility.
 */
export function projectVisibility(tx: TenantTx, tenant: TenantContext): SQL {
	if (isOrganizationOwner(tenant.role)) return sql`true`;

	const membership = exists(
		tx
			.select({ one: sql`1` })
			.from(projectMember)
			.where(
				and(
					eq(projectMember.projectId, project.id),
					eq(projectMember.userId, tenant.userId),
				),
			),
	);

	const role = myProjectRoleSql(tenant);

	return sql`${membership} and (
		${project.archivedAt} is null
		or ${role} in ('owner', 'admin')
		or (${role} = 'client' and ${project.archiveVisibleToClient})
	)`;
}

/**
 * True when the caller can see at least one archived project.
 *
 * Why a workspace level answer: the projects page decides whether to offer the
 * Archived filter before it knows which rows exist. An organization owner can
 * always see archived projects. Everyone else qualifies through a project role
 * that survives archiving (owner or admin), or as a client on a project that
 * opted in. A plain member never qualifies.
 */
export async function canSeeArchivedProjects(
	tx: TenantTx,
	tenant: TenantContext,
): Promise<boolean> {
	if (isOrganizationOwner(tenant.role)) return true;

	const [row] = await tx
		.select({ one: sql`1` })
		.from(projectMember)
		.innerJoin(project, eq(projectMember.projectId, project.id))
		.where(
			and(
				eq(projectMember.organizationId, tenant.organizationId),
				eq(projectMember.userId, tenant.userId),
				or(
					inArray(projectMember.role, ["owner", "admin"]),
					and(
						eq(projectMember.role, "client"),
						eq(project.archiveVisibleToClient, true),
					),
				),
			),
		)
		.limit(1);

	return Boolean(row);
}

/**
 * True when the caller pinned this project.
 *
 * A correlated subquery instead of a join keeps the project queries unchanged
 * and cannot duplicate rows when more than one activity row exists (it cannot,
 * the unique index forbids it, but the read stays safe by construction).
 */
export function pinnedProjectSql(tenant: TenantContext): SQL<boolean> {
	return sql<boolean>`exists (
		select 1 from project_pin pp
		where pp.project_id = "project"."id"
		and pp.user_id = ${tenant.userId}
	)`;
}

/**
 * Load one project and the caller's effective role, or null.
 *
 * Null means "not found for this caller": either the project does not exist in
 * the workspace or the caller is not one of its members. Routes turn that into
 * a 404 so the API never confirms that a hidden project exists.
 */
export async function loadProjectAccess(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
): Promise<ProjectAccess | null> {
	const myRole = myProjectRoleSql(tenant);

	const memberCount = sql<number>`(select count(*) from project_member pm
		where pm.project_id = "project"."id")`.mapWith(Number);

	const [row] = await tx
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
		.where(
			and(
				eq(project.organizationId, tenant.organizationId),
				eq(project.id, projectId),
			),
		)
		.limit(1);

	if (!row) return null;

	const role = effectiveProjectRole(tenant.role, row.myRole);

	// Organization owners always see every project. Everyone else must have a
	// membership row, which the policy cannot express without recursion.
	if (!role) return null;

	// An archived project is hidden from anyone who cannot see archived
	// projects. Answering 404 here means a stale tab or a direct URL never
	// confirms that a hidden project exists.
	if (
		row.archivedAt &&
		!canViewArchivedProject(role, row.archiveVisibleToClient)
	) {
		return null;
	}

	return { row, role };
}

/**
 * Load several projects and the caller's effective role in one query.
 *
 * Bulk actions need the same access decision as `loadProjectAccess`, but one
 * round trip for the whole selection. The result is keyed by project id and a
 * project the caller cannot see is absent, exactly like the single read
 * returning null.
 */
export async function loadProjectAccessMany(
	tx: TenantTx,
	tenant: TenantContext,
	projectIds: string[],
): Promise<Map<string, ProjectAccess>> {
	if (projectIds.length === 0) return new Map();

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
		.where(
			and(
				eq(project.organizationId, tenant.organizationId),
				inArray(project.id, projectIds),
			),
		);

	const access = new Map<string, ProjectAccess>();

	for (const row of rows) {
		const role = effectiveProjectRole(tenant.role, row.myRole);

		if (!role) continue;

		// An archived project is hidden from anyone who cannot see archived
		// projects, exactly like `loadProjectAccess`.
		if (
			row.archivedAt &&
			!canViewArchivedProject(role, row.archiveVisibleToClient)
		) {
			continue;
		}

		access.set(row.id, { row, role });
	}

	return access;
}
