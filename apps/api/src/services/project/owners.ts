/**
 * Organization owner projection.
 *
 * Why this file: organization owners are always project owners, and a missed
 * projection row is repaired here. Keeping the count and the sync together
 * means the last-owner rule sees the organization overlay.
 *
 * Used by: `members.ts` and `services/member.service.ts`.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { project, projectMember } from "../../db/schema";
import { type TenantTx, withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";

/**
 * Count the owners that would remain after removing one member.
 *
 * Project owner rows plus organization owners, deduplicated by user id. The
 * organization owner count is passed in because it comes from a privileged
 * read outside the tenant transaction.
 */
export async function countOwners(
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
