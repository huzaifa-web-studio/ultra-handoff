/**
 * Project business logic.
 *
 * Why a service: the routes stay HTTP only, and the project rules (who can see
 * a project, who may edit it, who may change a member) must be identical for
 * the list, the detail payload and every mutation. They all live here.
 *
 * Isolation has two layers:
 *   1. `withTenant` runs every query as `app_tenant`, so Postgres row level
 *      security confines the request to one organization.
 *   2. This module filters by project membership, because RLS only knows the
 *      organization. A project is visible to its members and to organization
 *      owners (who are always project owners).
 *
 * Better Auth tables are never joined inside a tenant query. Member and owner
 * lookups use the privileged client through small read only helpers in
 * organization.service.ts, matching the pattern used by the members feature.
 *
 * Used by: src/routes/projects.ts and the organization owner promotion hook in
 * src/services/member.service.ts.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import {
	and,
	asc,
	desc,
	eq,
	exists,
	ilike,
	inArray,
	isNull,
	ne,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

import { isOrganizationOwner } from "../auth/permissions";
import {
	assertProjectActive,
	assignableProjectRoles,
	canAssignProjectRole,
	canCreateProject,
	canDeleteProject,
	canEditProject,
	canManageProjectMembers,
	canManageProjectTarget,
	canViewArchivedProject,
	effectiveProjectRole,
	PROJECT_ROLE_LABELS,
	type ProjectRole,
	validateProjectDescription,
	validateProjectName,
	validateProjectSlug,
} from "../auth/project-permissions";
import { adminDb } from "../db";
import { user } from "../db/auth-schema";
import { project, projectMember, projectPin } from "../db/schema";
import { type TenantTx, withTenant } from "../db/tenant";
import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import type { BulkItemResult, BulkResult } from "../lib/bulk-result";
import { keyFromFileUrl } from "../lib/storage";
import type { TenantContext } from "../middleware/tenant";
import {
	getOrganizationMember,
	listOrganizationOwners,
	type OrganizationMemberRecord,
} from "./organization.service";
import { deletePreviousProjectLogo } from "./upload.service";

/** Lifecycle state derived from `archived_at`. */
export type ProjectStatus = "active" | "archived";

/** Sortable columns. Anything else falls back to the newest first. */
export type ProjectSort = "name" | "createdAt" | "updatedAt";

/** One row the projects table renders. */
export type ProjectRow = {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	description: string | null;
	status: ProjectStatus;
	myRole: ProjectRole;
	memberCount: number;
	canEdit: boolean;
	canDelete: boolean;
	/** True when a client keeps seeing this project after it is archived. */
	archiveVisibleToClient: boolean;
	/** True when the caller pinned the project in their own sidebar. */
	pinned: boolean;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
};

/** Capabilities of the caller, so the UI never guesses from a role string. */
export type ProjectViewer = {
	organizationRole: string;
	projectRole: ProjectRole;
	canEdit: boolean;
	canDelete: boolean;
	canManageMembers: boolean;
	/** True when the caller can still see this project while it is archived. */
	canSeeArchived: boolean;
	/** True when the caller may change the archive visibility setting. */
	canEditArchiveVisibility: boolean;
	/** True when the project is archived and therefore read-only. */
	locked: boolean;
	assignableRoles: ProjectRole[];
};

/** One project member, with the person attached. */
export type ProjectMemberRow = {
	userId: string;
	memberId: string;
	name: string;
	email: string;
	image: string | null;
	role: ProjectRole;
	isSelf: boolean;
	isOrganizationOwner: boolean;
	addedAt: string;
};

/** Everything the list page needs in one request. */
export type ProjectListResult = {
	organizationId: string;
	projects: ProjectRow[];
	viewer: {
		organizationRole: string;
		canCreate: boolean;
		/** True when the caller can see at least one archived project. */
		canSeeArchived: boolean;
	};
	counts: { all: number; active: number; archived: number };
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
};

/** Everything the edit and members dialogs need in one request. */
export type ProjectDetail = {
	organizationId: string;
	project: ProjectRow;
	members: ProjectMemberRow[];
	viewer: ProjectViewer;
};

/**
 * The lightweight shape the sidebar renders.
 *
 * Deliberately smaller than `ProjectRow`: the sidebar needs an identity, a
 * label and an archived hint, not member counts or capability flags.
 */
export type ProjectSummary = {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	status: ProjectStatus;
	pinned: boolean;
};

/** Everything the sidebar needs in one request. */
export type SidebarProjectsResult = {
	pinned: ProjectSummary[];
};

/** Normalised list filters, parsed and clamped by the route. */
export type ProjectListQuery = {
	search: string;
	status: "all" | ProjectStatus;
	sort: ProjectSort;
	direction: "asc" | "desc";
	page: number;
	pageSize: number;
};

/** Public write inputs. */
export type CreateProjectInput = {
	name: string;
	slug: string;
	description?: string | null;
	logo?: string | null;
};

export type UpdateProjectInput = {
	name?: string;
	slug?: string;
	/** An empty string clears the description, undefined leaves it untouched. */
	description?: string;
	/** An empty string clears the logo, undefined leaves it untouched. */
	logo?: string;
};

type ProjectAccess = {
	row: {
		id: string;
		name: string;
		slug: string;
		logo: string | null;
		description: string | null;
		archivedAt: Date | null;
		archiveVisibleToClient: boolean;
		createdAt: Date;
		updatedAt: Date;
		myRole: string | null;
		memberCount: number;
		pinned: boolean;
	};
	role: ProjectRole;
};

/** Escape LIKE wildcards so a search for "50%" is not a pattern. */
function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, "\\$&");
}

/** Reject anything that is not an object this API produced. */
function normalizeLogo(
	logo: string | null | undefined,
	organizationId: string,
): string | null {
	if (logo == null) return null;

	const value = logo.trim();

	if (value.length === 0) return null;

	if (value.length > 500) {
		throw new APIError("BAD_REQUEST", { message: "The logo URL is too long." });
	}

	const key = keyFromFileUrl(value);

	// Only objects this organization uploaded for a project may be attached.
	// That keeps an arbitrary external URL out of the project logo field.
	if (!key || key.includes("..") || key.includes("//")) {
		throw new APIError("BAD_REQUEST", {
			message: "The project logo must be an uploaded image.",
		});
	}

	if (!key.startsWith(`organizations/${organizationId}/projects/`)) {
		throw new APIError("BAD_REQUEST", {
			message: "The project logo does not belong to this organization.",
		});
	}

	return value;
}

/** Map a database row plus the caller's effective role into the wire shape. */
function toProjectRow(
	row: ProjectAccess["row"],
	tenant: TenantContext,
): ProjectRow {
	const role = effectiveProjectRole(tenant.role, row.myRole) ?? "member";

	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
		description: row.description,
		status: row.archivedAt ? "archived" : "active",
		myRole: role,
		memberCount: Number(row.memberCount ?? 0),
		canEdit: canEditProject(tenant.role, row.myRole),
		canDelete: canDeleteProject(tenant.role, row.myRole),
		archiveVisibleToClient: row.archiveVisibleToClient,
		pinned: Boolean(row.pinned),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
	};
}

/**
 * Build the viewer capabilities for one project.
 *
 * `canSeeArchived` is computed from the caller's effective role and the project
 * flag, so the UI never has to re-implement the archive visibility rule.
 *
 * `canManageMembers` is false while the project is archived, because every
 * member write is rejected in that state. `canEdit` stays role based so the
 * restore and delete controls remain reachable.
 */
function toProjectViewer(
	tenant: TenantContext,
	access: ProjectAccess,
): ProjectViewer {
	const { row, role } = access;
	const archived = row.archivedAt !== null;

	return {
		organizationRole: tenant.role,
		projectRole: role,
		canEdit: canEditProject(tenant.role, role),
		canDelete: canDeleteProject(tenant.role, role),
		canManageMembers: !archived && canManageProjectMembers(tenant.role, role),
		canSeeArchived:
			!archived || canViewArchivedProject(role, row.archiveVisibleToClient),
		canEditArchiveVisibility: canEditProject(tenant.role, role),
		locked: archived,
		assignableRoles: assignableProjectRoles(role),
	};
}

/**
 * The caller's project role as a correlated subquery.
 *
 * Shared by the visibility rule and the access loader so the two can never
 * disagree about which role the caller holds on a project.
 */
function myProjectRoleSql(tenant: TenantContext): SQL<string | null> {
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
function projectVisibility(tx: TenantTx, tenant: TenantContext): SQL {
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
async function canSeeArchivedProjects(
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
function pinnedProjectSql(tenant: TenantContext): SQL<boolean> {
	return sql<boolean>`exists (
		select 1 from project_pin pp
		where pp.project_id = "project"."id"
		and pp.user_id = ${tenant.userId}
	)`;
}

/** Map an activity joined row into the sidebar summary shape. */
function toProjectSummary(
	row: {
		id: string;
		name: string;
		slug: string;
		logo: string | null;
		archivedAt: Date | null;
		pinned?: boolean;
	},
	pinnedOverride?: boolean,
): ProjectSummary {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
		status: row.archivedAt ? "archived" : "active",
		pinned: pinnedOverride ?? Boolean(row.pinned),
	};
}

/**
 * Load one project and the caller's effective role, or null.
 *
 * Null means "not found for this caller": either the project does not exist in
 * the workspace or the caller is not one of its members. Routes turn that into
 * a 404 so the API never confirms that a hidden project exists.
 */
async function loadProjectAccess(
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

/** Translate a duplicate key error into a friendly slug or member message. */
function isUniqueViolation(error: unknown, constraint?: string): boolean {
	// Drizzle wraps driver failures in a DrizzleQueryError, so the SQLSTATE and
	// the constraint name live on the cause chain, not on the top level error.
	let current: unknown = error;

	for (let depth = 0; depth < 5; depth += 1) {
		if (typeof current !== "object" || current === null) return false;

		const candidate = current as {
			code?: unknown;
			constraint?: unknown;
			constraint_name?: unknown;
		};

		if (candidate.code === "23505") {
			if (!constraint) return true;

			// postgres-js exposes the Postgres field as `constraint_name`,
			// while other drivers use `constraint`. Accept both.
			return (
				candidate.constraint === constraint ||
				candidate.constraint_name === constraint
			);
		}

		current = (current as { cause?: unknown }).cause;
	}

	return false;
}

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

/**
 * Read the user rows for a set of member ids.
 *
 * Privileged on purpose: `user` is a Better Auth table, so it is read through
 * a small lookup instead of being joined into the tenant query. Read only.
 */
async function loadUserMap(
	userIds: string[],
): Promise<Map<string, { name: string; email: string; image: string | null }>> {
	if (userIds.length === 0) return new Map();

	const rows = await adminDb
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
		})
		.from(user)
		.where(inArray(user.id, userIds));

	return new Map(
		rows.map((row) => [
			row.id,
			{ name: row.name, email: row.email, image: row.image },
		]),
	);
}

/** Build the member list, merging organization owners who are always owners. */
async function buildMemberRows(
	tenant: TenantContext,
	projectId: string,
	fallbackAddedAt: string,
): Promise<ProjectMemberRow[]> {
	const rows = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		(tx) =>
			tx
				.select({
					memberId: projectMember.memberId,
					userId: projectMember.userId,
					role: projectMember.role,
					createdAt: projectMember.createdAt,
				})
				.from(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, tenant.organizationId),
						eq(projectMember.projectId, projectId),
					),
				)
				.orderBy(asc(projectMember.createdAt)),
	);

	const owners = await listOrganizationOwners(tenant.organizationId);
	const people = await loadUserMap([
		...new Set([
			...rows.map((row) => row.userId),
			...owners.map((o) => o.userId),
		]),
	]);

	const byUserId = new Map<string, ProjectMemberRow>();

	for (const row of rows) {
		const person = people.get(row.userId);

		byUserId.set(row.userId, {
			userId: row.userId,
			memberId: row.memberId,
			name: person?.name || person?.email || "Former member",
			email: person?.email ?? "",
			image: person?.image ?? null,
			role: row.role as ProjectRole,
			isSelf: row.userId === tenant.userId,
			isOrganizationOwner: false,
			addedAt: row.createdAt.toISOString(),
		});
	}

	// Organization owners are always project owners. Materializing the row on
	// create and promotion is the primary path; this merge is the safety net
	// for a sync that failed, so the dialog and permissions never disagree.
	for (const owner of owners) {
		const existing = byUserId.get(owner.userId);

		byUserId.set(owner.userId, {
			userId: owner.userId,
			memberId: owner.memberId,
			name: owner.name || owner.email,
			email: owner.email,
			image: owner.image,
			role: "owner",
			isSelf: owner.userId === tenant.userId,
			isOrganizationOwner: true,
			addedAt: existing?.addedAt ?? fallbackAddedAt,
		});
	}

	return [...byUserId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Project, members and viewer capabilities for the edit dialogs. */
export async function getProjectDetail(
	tenant: TenantContext,
	projectId: string,
): Promise<ProjectDetail> {
	const access = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		(tx) => loadProjectAccess(tx, tenant, projectId),
	);

	if (!access) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}

	const projectRow = toProjectRow(access.row, tenant);
	const members = await buildMemberRows(
		tenant,
		projectId,
		projectRow.createdAt,
	);

	return {
		organizationId: tenant.organizationId,
		project: { ...projectRow, memberCount: members.length },
		members,
		viewer: toProjectViewer(tenant, access),
	};
}

/**
 * Load a project by its workspace-unique slug.
 *
 * The browser URL uses the slug because it is readable and stable for people.
 * The slug is unique per organization, so the lookup is exact. The visibility
 * rule is applied before the detail is built, which means a slug the caller
 * cannot see answers 404 exactly like an id they cannot see. Nothing here
 * leaks whether the project exists.
 */
export async function getProjectDetailBySlug(
	tenant: TenantContext,
	slug: string,
): Promise<ProjectDetail> {
	const projectId = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const [row] = await tx
				.select({ id: project.id })
				.from(project)
				.where(
					and(
						eq(project.organizationId, tenant.organizationId),
						eq(project.slug, slug),
						projectVisibility(tx, tenant),
					),
				)
				.limit(1);

			return row?.id ?? null;
		},
	);

	if (!projectId) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}

	return getProjectDetail(tenant, projectId);
}

/**
 * Create a project.
 *
 * Only organization owners and admins may create. The creator becomes the
 * project owner, and every organization owner is added as an owner so the
 * "organization owners own every project" rule is materialized from day one.
 */
export async function createProject(
	tenant: TenantContext,
	input: CreateProjectInput,
): Promise<ProjectDetail> {
	if (!canCreateProject(tenant.role)) {
		throw new APIError("FORBIDDEN", {
			message: "Only organization owners and admins can create projects.",
		});
	}

	const name = validateProjectName(input.name);
	const slug = validateProjectSlug(input.slug);
	const description = validateProjectDescription(input.description);
	const logo = normalizeLogo(input.logo, tenant.organizationId);

	// Owners are read before the transaction: they are Better Auth rows and
	// belong on the privileged client, not inside a tenant query.
	const owners = await listOrganizationOwners(tenant.organizationId);

	// The creator may be a plain admin, so they are not in the owner list.
	const ownerRows = new Map<string, string>();
	for (const owner of owners) ownerRows.set(owner.userId, owner.memberId);
	if (!ownerRows.has(tenant.userId)) {
		ownerRows.set(tenant.userId, tenant.memberId);
	}

	const projectId = randomUUID();

	try {
		await withTenant(
			{ organizationId: tenant.organizationId, userId: tenant.userId },
			async (tx) => {
				await tx.insert(project).values({
					id: projectId,
					organizationId: tenant.organizationId,
					name,
					slug,
					description,
					logo,
					createdBy: tenant.userId,
				});

				await tx.insert(projectMember).values(
					[...ownerRows.entries()].map(([userId, memberId]) => ({
						id: randomUUID(),
						organizationId: tenant.organizationId,
						projectId,
						memberId,
						userId,
						role: "owner",
					})),
				);
			},
		);
	} catch (error) {
		if (isUniqueViolation(error, "project_organization_slug_idx")) {
			throw new APIError("BAD_REQUEST", {
				message: "That slug is already used by another project.",
			});
		}

		throw error;
	}

	return getProjectDetail(tenant, projectId);
}

/**
 * Update the editable project fields.
 *
 * Requires an owner or admin project role. The logo is validated against the
 * workspace's project prefix, and the replaced object is removed after the
 * database write succeeds.
 */
export async function updateProject(
	tenant: TenantContext,
	projectId: string,
	input: UpdateProjectInput,
): Promise<ProjectDetail> {
	const previousLogo = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			if (!canEditProject(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message: "Only project owners and admins can edit a project.",
				});
			}

			// An archived project is read-only. Restoring it is the only way to
			// make it editable again.
			assertProjectActive(access.row.archivedAt);

			const patch: {
				name?: string;
				slug?: string;
				description?: string | null;
				logo?: string | null;
			} = {};

			if (input.name !== undefined) {
				patch.name = validateProjectName(input.name);
			}

			if (input.slug !== undefined) {
				patch.slug = validateProjectSlug(input.slug);
			}

			if (input.description !== undefined) {
				patch.description = validateProjectDescription(input.description);
			}

			if (input.logo !== undefined) {
				patch.logo = normalizeLogo(input.logo, tenant.organizationId);
			}

			if (Object.keys(patch).length === 0) {
				throw new APIError("BAD_REQUEST", {
					message: "There is nothing to update.",
				});
			}

			try {
				await tx
					.update(project)
					.set(patch)
					.where(
						and(
							eq(project.organizationId, tenant.organizationId),
							eq(project.id, projectId),
						),
					);
			} catch (error) {
				if (isUniqueViolation(error, "project_organization_slug_idx")) {
					throw new APIError("BAD_REQUEST", {
						message: "That slug is already used by another project.",
					});
				}

				throw error;
			}

			// Only clean up when the logo actually changed. Re-submitting the
			// same URL must not delete the object the row still points at.
			return patch.logo !== undefined && patch.logo !== access.row.logo
				? access.row.logo
				: null;
		},
	);

	if (previousLogo) {
		await deletePreviousProjectLogo(tenant.organizationId, previousLogo);
	}

	return getProjectDetail(tenant, projectId);
}

/** Archive or restore a project. Idempotent, so a double click is harmless. */
export async function setProjectArchived(
	tenant: TenantContext,
	projectId: string,
	archived: boolean,
): Promise<{ status: ProjectStatus; archivedAt: string | null }> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			if (!canEditProject(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message:
						"Only project owners and admins can archive or restore a project.",
				});
			}

			const alreadyArchived = access.row.archivedAt !== null;
			if (alreadyArchived === archived) {
				return {
					status: access.row.archivedAt ? "archived" : "active",
					archivedAt: access.row.archivedAt
						? access.row.archivedAt.toISOString()
						: null,
				};
			}

			const archivedAt = archived ? new Date() : null;

			await tx
				.update(project)
				.set({ archivedAt })
				.where(
					and(
						eq(project.organizationId, tenant.organizationId),
						eq(project.id, projectId),
					),
				);

			return {
				status: archived ? "archived" : "active",
				archivedAt: archivedAt ? archivedAt.toISOString() : null,
			};
		},
	);
}

/**
 * Choose whether clients keep seeing this project while it is archived.
 *
 * Deliberately allowed while the project is archived. Hiding or revealing an
 * archived project is a visibility decision, not content work, and forcing a
 * restore first would make the setting unreachable exactly when it matters.
 *
 * Owners and admins only. The `member` role is never affected by this flag.
 */
export async function setProjectArchiveVisibility(
	tenant: TenantContext,
	projectId: string,
	visibleToClient: boolean,
): Promise<{ archiveVisibleToClient: boolean }> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			if (!canEditProject(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message:
						"Only project owners and admins can change the archive visibility.",
				});
			}

			if (access.row.archiveVisibleToClient !== visibleToClient) {
				await tx
					.update(project)
					.set({ archiveVisibleToClient: visibleToClient })
					.where(
						and(
							eq(project.organizationId, tenant.organizationId),
							eq(project.id, projectId),
						),
					);
			}

			return { archiveVisibleToClient: visibleToClient };
		},
	);
}

/**
 * Permanently delete a project.
 *
 * Owner only. Memberships cascade with the row, and the logo object is removed
 * after the database write succeeds.
 */
export async function deleteProject(
	tenant: TenantContext,
	projectId: string,
): Promise<{ status: "ok" }> {
	const previousLogo = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			if (!canDeleteProject(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message: "Only a project owner can delete a project.",
				});
			}

			await tx
				.delete(project)
				.where(
					and(
						eq(project.organizationId, tenant.organizationId),
						eq(project.id, projectId),
					),
				);

			return access.row.logo;
		},
	);

	if (previousLogo) {
		await deletePreviousProjectLogo(tenant.organizationId, previousLogo);
	}

	return { status: "ok" };
}

/**
 * Insert the membership row for an already resolved organization member.
 *
 * Why a private helper: the single add and the bulk add share every rule
 * (workspace membership, project access, assignable roles, duplicate guard).
 * The bulk path resolves each target and reuses this, so the two paths can
 * never drift apart.
 */
async function insertProjectMember(
	tenant: TenantContext,
	projectId: string,
	target: OrganizationMemberRecord,
	role: ProjectRole,
): Promise<{ userId: string; role: ProjectRole }> {
	const forcedByOrganization = isOrganizationOwner(target.role);
	const finalRole: ProjectRole = forcedByOrganization ? "owner" : role;

	await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			if (!canManageProjectMembers(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message: "Only project owners and admins can add members.",
				});
			}

			assertProjectActive(access.row.archivedAt);

			if (
				!forcedByOrganization &&
				!canAssignProjectRole(access.role, finalRole)
			) {
				throw new APIError("FORBIDDEN", {
					message: "You cannot assign that project role.",
				});
			}

			try {
				await tx.insert(projectMember).values({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					projectId,
					memberId: target.memberId,
					userId: target.userId,
					role: finalRole,
				});
			} catch (error) {
				if (isUniqueViolation(error, "project_member_project_member_idx")) {
					throw new APIError("BAD_REQUEST", {
						message: "That person is already on this project.",
					});
				}

				throw error;
			}
		},
	);

	return { userId: target.userId, role: finalRole };
}

/** Read the names for a batch, so a bulk result can label its rows. */
async function loadProjectLabels(
	tenant: TenantContext,
	projectIds: string[],
): Promise<Map<string, string>> {
	if (projectIds.length === 0) return new Map();

	const rows = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		(tx) =>
			tx
				.select({ id: project.id, name: project.name })
				.from(project)
				.where(
					and(
						eq(project.organizationId, tenant.organizationId),
						inArray(project.id, projectIds),
					),
				),
	);

	return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Archive or restore several projects in one request.
 *
 * Why a loop instead of one SQL update: `setProjectArchived` owns the access
 * check and the idempotent early return. Calling it per project keeps a bulk
 * action identical to the single row action, and a project the caller cannot
 * edit is reported as skipped instead of failing the whole batch.
 */
export async function bulkSetProjectsArchived(
	tenant: TenantContext,
	projectIds: string[],
	archived: boolean,
): Promise<BulkResult> {
	const labels = await loadProjectLabels(tenant, projectIds);
	const results: BulkItemResult[] = [];

	for (const projectId of projectIds) {
		const label = labels.get(projectId) ?? projectId;

		try {
			await setProjectArchived(tenant, projectId, archived);

			results.push({
				key: projectId,
				label,
				status: archived ? "archived" : "restored",
				message: archived ? "Project archived." : "Project restored.",
			});
		} catch (error) {
			const status = authErrorStatus(error);
			const skipped = status === 400 || status === 403 || status === 404;

			results.push({
				key: projectId,
				label,
				status: skipped ? "skipped" : "failed",
				message: authErrorMessage(
					error,
					archived
						? "Could not archive that project."
						: "Could not restore that project.",
				),
			});
		}
	}

	return { results };
}

/**
 * Permanently delete several projects in one request.
 *
 * The owner check, cascade and logo cleanup stay inside `deleteProject`, so the
 * bulk path cannot bypass a rule the single delete enforces. Each outcome is
 * returned so a mixed selection is not silently partial.
 */
export async function bulkDeleteProjects(
	tenant: TenantContext,
	projectIds: string[],
): Promise<BulkResult> {
	const labels = await loadProjectLabels(tenant, projectIds);
	const results: BulkItemResult[] = [];

	for (const projectId of projectIds) {
		const label = labels.get(projectId) ?? projectId;

		try {
			await deleteProject(tenant, projectId);

			results.push({
				key: projectId,
				label,
				status: "deleted",
				message: "Project deleted.",
			});
		} catch (error) {
			const status = authErrorStatus(error);
			const skipped = status === 400 || status === 403 || status === 404;

			results.push({
				key: projectId,
				label,
				status: skipped ? "skipped" : "failed",
				message: authErrorMessage(error, "Could not delete that project."),
			});
		}
	}

	return { results };
}

/**
 * Add an organization member to a project.
 *
 * The target must still be a member of the workspace (the picker may be
 * stale), must not already be on the project, and must be given a role the
 * actor is allowed to hand out. Organization owners are always project owners.
 */
export async function addProjectMember(
	tenant: TenantContext,
	projectId: string,
	targetUserId: string,
	role: ProjectRole,
): Promise<{ userId: string; role: ProjectRole }> {
	const target = await getOrganizationMember(
		tenant.organizationId,
		targetUserId,
	);

	if (!target) {
		throw new APIError("BAD_REQUEST", {
			message: "That person is no longer part of this organization.",
		});
	}

	return insertProjectMember(tenant, projectId, target, role);
}

/**
 * Add several organization members to one project in a single request.
 *
 * Per item outcomes instead of one all or nothing error: a batch can contain
 * someone who left the workspace, someone already on the project and someone
 * the actor cannot assign a role to, and the user needs to see which is which.
 * Each item still runs the same guards as the single add.
 */
export async function bulkAddProjectMembers(
	tenant: TenantContext,
	projectId: string,
	targetUserIds: string[],
	role: ProjectRole,
): Promise<BulkResult> {
	const results: BulkItemResult[] = [];

	for (const userId of targetUserIds) {
		// Resolve first so a missing person gets a readable label, not an id.
		const target = await getOrganizationMember(tenant.organizationId, userId);

		if (!target) {
			results.push({
				key: userId,
				label: userId,
				status: "skipped",
				code: "MEMBER_NOT_FOUND",
				message: "That person is no longer part of this organization.",
			});
			continue;
		}

		const label = target.name || target.email || userId;

		try {
			const added = await insertProjectMember(tenant, projectId, target, role);

			results.push({
				key: userId,
				label,
				status: "added",
				message:
					added.role === role
						? `Added as ${PROJECT_ROLE_LABELS[added.role]}.`
						: "Added as Owner because they own the organization.",
			});
		} catch (error) {
			// A 403 or 400 means the rule refused this row, which the dialog
			// shows as skipped. Anything else is an unexpected failure.
			const status = authErrorStatus(error);
			const skipped = status === 400 || status === 403 || status === 404;

			results.push({
				key: userId,
				label,
				status: skipped ? "skipped" : "failed",
				message: authErrorMessage(error, "Could not add that person."),
			});
		}
	}

	return { results };
}

/**
 * Change one project member's role.
 *
 * Mirrors the organization rules: nobody edits their own role, only an owner
 * manages admins and owners, and an organization owner cannot be demoted.
 */
export async function updateProjectMemberRole(
	tenant: TenantContext,
	projectId: string,
	targetUserId: string,
	role: ProjectRole,
): Promise<{ userId: string; role: ProjectRole }> {
	if (targetUserId === tenant.userId) {
		throw new APIError("BAD_REQUEST", {
			message: "You cannot change your own project role.",
		});
	}

	const targetOrgMember = await getOrganizationMember(
		tenant.organizationId,
		targetUserId,
	);

	if (targetOrgMember && isOrganizationOwner(targetOrgMember.role)) {
		throw new APIError("BAD_REQUEST", {
			message: "Organization owners are always project owners.",
		});
	}

	const owners = await listOrganizationOwners(tenant.organizationId);

	await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			if (!canManageProjectMembers(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message: "Only project owners and admins can change roles.",
				});
			}

			assertProjectActive(access.row.archivedAt);

			const [target] = await tx
				.select({ role: projectMember.role })
				.from(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, tenant.organizationId),
						eq(projectMember.projectId, projectId),
						eq(projectMember.userId, targetUserId),
					),
				)
				.limit(1);

			if (!target) {
				throw new APIError("NOT_FOUND", {
					message: "That person is not on this project.",
				});
			}

			if (!canManageProjectTarget(access.role, target.role)) {
				throw new APIError("FORBIDDEN", {
					message: "Only a project owner can change an admin or an owner.",
				});
			}

			if (role === "owner" && access.role !== "owner") {
				throw new APIError("FORBIDDEN", {
					message: "Only a project owner can promote someone to owner.",
				});
			}

			if (target.role === "owner" && role !== "owner") {
				const remaining = await countOwners(
					tx,
					tenant,
					projectId,
					targetUserId,
					owners.length,
				);

				if (remaining <= 0) {
					throw new APIError("BAD_REQUEST", {
						message: "A project needs at least one owner.",
					});
				}
			}

			await tx
				.update(projectMember)
				.set({ role })
				.where(
					and(
						eq(projectMember.organizationId, tenant.organizationId),
						eq(projectMember.projectId, projectId),
						eq(projectMember.userId, targetUserId),
					),
				);
		},
	);

	return { userId: targetUserId, role };
}

/**
 * Count the owners that would remain after removing one member.
 *
 * Project owner rows plus organization owners, deduplicated by user id. The
 * organization owner count is passed in because it comes from a privileged
 * read outside the tenant transaction.
 */
async function countOwners(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	excludedUserId: string,
	organizationOwnerCount: number,
): Promise<number> {
	const [row] = await tx
		.select({ value: sql<number>`count(*)`.mapWith(Number) })
		.from(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, tenant.organizationId),
				eq(projectMember.projectId, projectId),
				eq(projectMember.role, "owner"),
				ne(projectMember.userId, excludedUserId),
			),
		);

	return (row?.value ?? 0) + organizationOwnerCount;
}

/** Remove one project member. Self removal and last owner rules apply. */
export async function removeProjectMember(
	tenant: TenantContext,
	projectId: string,
	targetUserId: string,
): Promise<{ status: "ok" }> {
	if (targetUserId === tenant.userId) {
		throw new APIError("BAD_REQUEST", {
			message: "Ask another project owner to remove you.",
		});
	}

	const targetOrgMember = await getOrganizationMember(
		tenant.organizationId,
		targetUserId,
	);

	if (targetOrgMember && isOrganizationOwner(targetOrgMember.role)) {
		throw new APIError("BAD_REQUEST", {
			message: "Organization owners always own every project.",
		});
	}

	const owners = await listOrganizationOwners(tenant.organizationId);

	await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			if (!canManageProjectMembers(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message: "Only project owners and admins can remove members.",
				});
			}

			assertProjectActive(access.row.archivedAt);

			const [target] = await tx
				.select({ role: projectMember.role })
				.from(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, tenant.organizationId),
						eq(projectMember.projectId, projectId),
						eq(projectMember.userId, targetUserId),
					),
				)
				.limit(1);

			if (!target) {
				throw new APIError("NOT_FOUND", {
					message: "That person is not on this project.",
				});
			}

			if (!canManageProjectTarget(access.role, target.role)) {
				throw new APIError("FORBIDDEN", {
					message: "Only a project owner can remove an admin or an owner.",
				});
			}

			if (target.role === "owner") {
				const remaining = await countOwners(
					tx,
					tenant,
					projectId,
					targetUserId,
					owners.length,
				);

				if (remaining <= 0) {
					throw new APIError("BAD_REQUEST", {
						message: "A project needs at least one owner.",
					});
				}
			}

			await tx
				.delete(projectMember)
				.where(
					and(
						eq(projectMember.organizationId, tenant.organizationId),
						eq(projectMember.projectId, projectId),
						eq(projectMember.userId, targetUserId),
					),
				);
		},
	);

	return { status: "ok" };
}

/**
 * Remove several project members in one request.
 *
 * Loops the single removal so the self check, organization owner rule, target
 * permission and last owner rule stay identical. Per item outcomes let the
 * dialog report a mixed selection honestly instead of failing the whole batch.
 */
export async function bulkRemoveProjectMembers(
	tenant: TenantContext,
	projectId: string,
	targetUserIds: string[],
): Promise<BulkResult> {
	const people = await loadUserMap(targetUserIds);
	const results: BulkItemResult[] = [];

	for (const userId of targetUserIds) {
		const person = people.get(userId);
		const label = person?.name || person?.email || userId;

		try {
			await removeProjectMember(tenant, projectId, userId);

			results.push({
				key: userId,
				label,
				status: "removed",
				message: "Removed from the project.",
			});
		} catch (error) {
			const status = authErrorStatus(error);
			const skipped = status === 400 || status === 403 || status === 404;

			results.push({
				key: userId,
				label,
				status: skipped ? "skipped" : "failed",
				message: authErrorMessage(error, "Could not remove that person."),
			});
		}
	}

	return { results };
}

/**
 * Add a newly promoted organization owner to every project as owner.
 *
 * Called after Better Auth promotes a member to owner. A failure here must not
 * fail the promotion: access checks treat organization owners as project
 * owners, so the overlay covers a missed row until the next sync.
 */
export async function syncOrganizationOwnerToProjects(
	tenant: TenantContext,
	target: { userId: string; memberId: string },
): Promise<void> {
	try {
		await withTenant(
			{ organizationId: tenant.organizationId, userId: tenant.userId },
			async (tx) => {
				// Archived projects are skipped on purpose. They are read-only,
				// and the organization owner overlay already lets this person
				// see and restore them without a membership row.
				const projects = await tx
					.select({ id: project.id })
					.from(project)
					.where(
						and(
							eq(project.organizationId, tenant.organizationId),
							isNull(project.archivedAt),
						),
					);

				if (projects.length === 0) return;

				const projectIds = projects.map((row) => row.id);

				const existing = await tx
					.select({ projectId: projectMember.projectId })
					.from(projectMember)
					.where(
						and(
							eq(projectMember.organizationId, tenant.organizationId),
							eq(projectMember.userId, target.userId),
							inArray(projectMember.projectId, projectIds),
						),
					);

				const have = new Set(existing.map((row) => row.projectId));

				if (have.size > 0) {
					await tx
						.update(projectMember)
						.set({ role: "owner" })
						.where(
							and(
								eq(projectMember.organizationId, tenant.organizationId),
								eq(projectMember.userId, target.userId),
								inArray(projectMember.projectId, [...have]),
							),
						);
				}

				const missing = projects.filter((row) => !have.has(row.id));

				if (missing.length > 0) {
					await tx.insert(projectMember).values(
						missing.map((row) => ({
							id: randomUUID(),
							organizationId: tenant.organizationId,
							projectId: row.id,
							memberId: target.memberId,
							userId: target.userId,
							role: "owner",
						})),
					);
				}
			},
		);
	} catch {
		// Best effort. The organization role is the source of truth and the
		// permission overlay already treats this user as a project owner.
	}
}
