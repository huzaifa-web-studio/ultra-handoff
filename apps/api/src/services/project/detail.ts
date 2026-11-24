/**
 * Project detail and people lookup.
 *
 * Why this file: the detail pane needs the project row, its viewer
 * capabilities and its member rows in one response, and the people picker
 * needs the same member mapping. Both live here.
 *
 * Used by: `routes/projects.ts`.
 */

import { APIError } from "better-auth/api";
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import type { ProjectRole } from "../../auth/project-permissions";
import { adminDb } from "../../db";
import { user } from "../../db/auth-schema";
import { project, projectMember } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { escapeLike } from "../../lib/query";
import type { TenantContext } from "../../middleware/tenant";
import { listOrganizationOwners } from "../organization.service";
import { loadUserMap } from "../user.service";
import { loadProjectAccess, projectVisibility } from "./access";
import { toProjectRow, toProjectViewer } from "./payload";
import type { ProjectDetail, ProjectMemberRow } from "./types";

/** One Better Auth user row, in the shape the mention picker needs. */
export type UserProfile = {
	id: string;
	name: string;
	email: string;
	image: string | null;
};

/**
 * Search a bounded set of users by name or email.
 *
 * Why SQL instead of loading every profile: the mention picker only shows a few
 * rows, but a project may have thousands of members. Filtering their names in
 * memory meant transferring every profile on each keystroke. This query stays on
 * the privileged client (Better Auth tables are never joined into a tenant
 * query) and stops at `limit + 1`, which also answers "is there more".
 *
 * The caller passes the member ids it already read through the tenant client.
 * That keeps project membership enforced by the existing scope.
 */
export async function searchUserProfiles(
	userIds: string[],
	search: string,
	limit: number,
): Promise<UserProfile[]> {
	if (userIds.length === 0) return [];

	const term = search.trim();
	const pattern = term.length > 0 ? `%${escapeLike(term)}%` : null;

	return adminDb
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
		})
		.from(user)
		.where(
			and(
				inArray(user.id, userIds),
				...(pattern
					? [or(ilike(user.name, pattern), ilike(user.email, pattern))]
					: []),
			),
		)
		.orderBy(asc(user.name))
		.limit(limit);
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
