/**
 * Milestone assignee reads and persistence.
 *
 * Why this file: loading, validating and replacing the assignee set is shared
 * by create, update and the dedicated assignee endpoint. Keeping the primitives
 * together means the "an assignee must be a project member" rule cannot drift
 * between those paths.
 *
 * Used by: `payload.ts`, `create.ts`, `update.ts` and `set-assignees.ts`.
 */

import { randomUUID } from "node:crypto";

import { APIError } from "better-auth/api";
import { and, asc, eq, inArray } from "drizzle-orm";

import { MILESTONE_ASSIGNEE_MAX } from "../../auth/milestone-permissions";
import { milestoneAssignee, projectMember } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { listOrganizationOwners } from "../organization.service";
import { loadUserMap } from "../project";
import type { MilestoneAssigneeRow } from "./types";

/**
 * Load the assignees for a set of milestones in one query.
 *
 * The join reads `project_member` inside the tenant query (it is a business
 * table), then names come from the privileged user lookup. This is the only
 * shape that avoids both an N+1 and a Better Auth join.
 */
export async function loadAssignees(
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
 * Turn requested user ids into project member rows.
 *
 * Why this is not just a map: an assignee must be a member of this project.
 * Organization owners are always project owners, so an owner without a
 * materialized row (a missed sync) is repaired here rather than rejected. That
 * self heals the invariant the rest of the permission model already assumes.
 */
export async function resolveAssigneeMemberIds(
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
export async function replaceAssignees(
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
