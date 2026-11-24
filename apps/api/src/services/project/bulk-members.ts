/**
 * Bulk project member actions.
 *
 * Why this file: bulk add and bulk remove resolve every target before writing
 * and return one result per person. They reuse the single-member rules but
 * have their own partial failure contract.
 *
 * Used by: `routes/projects.ts`.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { isOrganizationOwner } from "../../auth/permissions";
import {
	canAssignProjectRole,
	canManageProjectMembers,
	canManageProjectTarget,
	PROJECT_ARCHIVED_MESSAGE,
	PROJECT_ROLE_LABELS,
	type ProjectRole,
} from "../../auth/project-permissions";
import { projectMember } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { BulkItemResult, BulkResult } from "../../lib/bulk-result";
import type { TenantContext } from "../../middleware/tenant";
import { publishMemberRevocation } from "../../realtime/bus";
import {
	createNotifications,
	type NotificationDelivery,
} from "../notification.service";
import {
	getOrganizationMembers,
	listOrganizationOwners,
} from "../organization.service";
import { loadUserMap } from "../user.service";
import { loadProjectAccess } from "./access";

/**
 * Add several organization members to one project in a single request.
 *
 * One access read, one target lookup and one insert for the whole selection.
 * Per item outcomes are preserved: a batch can contain someone who left the
 * workspace, someone already on the project and someone the actor cannot
 * assign a role to, and the dialog needs to show which is which.
 *
 * `onConflictDoNothing` keeps a concurrent insert from aborting the batch; the
 * row that lost the race is reported as already on the project.
 */
export async function bulkAddProjectMembers(
	tenant: TenantContext,
	projectId: string,
	targetUserIds: string[],
	role: ProjectRole,
): Promise<BulkResult & { notifications: NotificationDelivery[] }> {
	// Better Auth member rows are resolved in one privileged read, outside the
	// tenant transaction, because they are not business tables.
	const targets = await getOrganizationMembers(
		tenant.organizationId,
		targetUserIds,
	);

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);
			const outcome = new Map<string, BulkItemResult>();
			const toResults = () =>
				targetUserIds.flatMap((userId) => {
					const item = outcome.get(userId);
					return item ? [item] : [];
				});

			if (!access) {
				for (const userId of targetUserIds) {
					const target = targets.get(userId);

					outcome.set(userId, {
						key: userId,
						label: target?.name || target?.email || userId,
						status: "skipped",
						message: "That project no longer exists.",
					});
				}

				return {
					results: toResults(),
					notifications: [] as NotificationDelivery[],
				};
			}

			const canManage = canManageProjectMembers(tenant.role, access.role);
			const active = access.row.archivedAt === null;

			// One read for the memberships that already exist.
			const existingRows =
				targetUserIds.length === 0
					? []
					: await tx
							.select({ userId: projectMember.userId })
							.from(projectMember)
							.where(
								and(
									eq(projectMember.organizationId, tenant.organizationId),
									eq(projectMember.projectId, projectId),
									inArray(projectMember.userId, targetUserIds),
								),
							);
			const existing = new Set(existingRows.map((row) => row.userId));
			const toInsert: Array<{
				id: string;
				organizationId: string;
				projectId: string;
				memberId: string;
				userId: string;
				role: ProjectRole;
			}> = [];

			for (const userId of targetUserIds) {
				const target = targets.get(userId);

				if (!target) {
					outcome.set(userId, {
						key: userId,
						label: userId,
						status: "skipped",
						code: "MEMBER_NOT_FOUND",
						message: "That person is no longer part of this organization.",
					});
					continue;
				}

				const label = target.name || target.email || userId;
				const forcedByOrganization = isOrganizationOwner(target.role);
				const finalRole: ProjectRole = forcedByOrganization ? "owner" : role;

				if (!canManage) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "Only project owners and admins can add members.",
					});
					continue;
				}

				if (!active) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: PROJECT_ARCHIVED_MESSAGE,
					});
					continue;
				}

				if (
					!forcedByOrganization &&
					!canAssignProjectRole(access.role, finalRole)
				) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "You cannot assign that project role.",
					});
					continue;
				}

				if (existing.has(userId)) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "That person is already on this project.",
					});
					continue;
				}

				existing.add(userId);
				toInsert.push({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					projectId,
					memberId: target.memberId,
					userId,
					role: finalRole,
				});
			}

			let insertedUserIds = new Set<string>();

			if (toInsert.length > 0) {
				const inserted = await tx
					.insert(projectMember)
					.values(toInsert)
					.onConflictDoNothing()
					.returning({ userId: projectMember.userId });
				insertedUserIds = new Set(inserted.map((row) => row.userId));

				for (const row of toInsert) {
					const target = targets.get(row.userId);
					const label = target?.name || target?.email || row.userId;

					outcome.set(
						row.userId,
						insertedUserIds.has(row.userId)
							? {
									key: row.userId,
									label,
									status: "added",
									message:
										row.role === role
											? `Added as ${PROJECT_ROLE_LABELS[row.role]}.`
											: "Added as Owner because they own the organization.",
								}
							: {
									key: row.userId,
									label,
									status: "skipped",
									message: "That person is already on this project.",
								},
					);
				}
			}

			const notifications =
				insertedUserIds.size > 0
					? await createNotifications(
							tx,
							tenant,
							(
								await tx
									.select({
										id: projectMember.id,
										userId: projectMember.userId,
										role: projectMember.role,
									})
									.from(projectMember)
									.where(
										and(
											eq(projectMember.organizationId, tenant.organizationId),
											eq(projectMember.projectId, projectId),
											inArray(projectMember.userId, [...insertedUserIds]),
										),
									)
							).map((row) => ({
								recipientUserId: row.userId,
								actorUserId: tenant.userId,
								type: "project_member_added" as const,
								dedupeKey: `project_member:${row.id}`,
								project: {
									id: access.row.id,
									name: access.row.name,
									slug: access.row.slug,
								},
								data: { role: row.role },
							})),
						)
					: [];

			return { results: toResults(), notifications };
		},
	);
}

/**
 * Remove several project members in one request.
 *
 * One access read, one membership read and one delete statement. The self
 * check, organization owner rule, target permission and last owner rule are
 * evaluated from that read, and per item outcomes still let the dialog report
 * a mixed selection honestly instead of failing the whole batch.
 */
export async function bulkRemoveProjectMembers(
	tenant: TenantContext,
	projectId: string,
	targetUserIds: string[],
): Promise<BulkResult> {
	// Labels and Better Auth roles come from privileged reads outside the
	// tenant transaction.
	const people = await loadUserMap(targetUserIds);
	const targets = await getOrganizationMembers(
		tenant.organizationId,
		targetUserIds,
	);
	const organizationOwnerCount = (
		await listOrganizationOwners(tenant.organizationId)
	).length;
	const removed: string[] = [];

	const results = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);
			const outcome = new Map<string, BulkItemResult>();
			const toDelete = new Set<string>();
			const membership = new Map<string, string>();
			let ownerRowCount = 0;
			let removedOwners = 0;

			const toResults = () =>
				targetUserIds.flatMap((userId) => {
					const item = outcome.get(userId);
					return item ? [item] : [];
				});

			if (access) {
				// One read for the selected memberships and one for the current
				// owner rows, instead of two queries per item.
				const rows =
					targetUserIds.length === 0
						? []
						: await tx
								.select({
									userId: projectMember.userId,
									role: projectMember.role,
								})
								.from(projectMember)
								.where(
									and(
										eq(projectMember.organizationId, tenant.organizationId),
										eq(projectMember.projectId, projectId),
										inArray(projectMember.userId, targetUserIds),
									),
								);

				for (const row of rows) membership.set(row.userId, row.role);

				const owners = await tx
					.select({ userId: projectMember.userId })
					.from(projectMember)
					.where(
						and(
							eq(projectMember.organizationId, tenant.organizationId),
							eq(projectMember.projectId, projectId),
							eq(projectMember.role, "owner"),
						),
					);
				ownerRowCount = owners.length;
			}

			const canManage = access
				? canManageProjectMembers(tenant.role, access.role)
				: false;
			const active = access ? access.row.archivedAt === null : false;

			for (const userId of targetUserIds) {
				const person = people.get(userId);
				const label = person?.name || person?.email || userId;
				const target = targets.get(userId);

				if (userId === tenant.userId) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "Ask another project owner to remove you.",
					});
					continue;
				}

				if (target && isOrganizationOwner(target.role)) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "Organization owners always own every project.",
					});
					continue;
				}

				if (!access) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "That project no longer exists.",
					});
					continue;
				}

				if (!canManage) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "Only project owners and admins can remove members.",
					});
					continue;
				}

				if (!active) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: PROJECT_ARCHIVED_MESSAGE,
					});
					continue;
				}

				const memberRole = membership.get(userId);

				if (!memberRole) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "That person is not on this project.",
					});
					continue;
				}

				if (!canManageProjectTarget(access.role, memberRole)) {
					outcome.set(userId, {
						key: userId,
						label,
						status: "skipped",
						message: "Only a project owner can remove an admin or an owner.",
					});
					continue;
				}

				if (memberRole === "owner") {
					const remaining =
						ownerRowCount - removedOwners - 1 + organizationOwnerCount;

					if (remaining <= 0) {
						outcome.set(userId, {
							key: userId,
							label,
							status: "skipped",
							message: "A project needs at least one owner.",
						});
						continue;
					}

					removedOwners += 1;
				}

				toDelete.add(userId);
				outcome.set(userId, {
					key: userId,
					label,
					status: "removed",
					message: "Removed from the project.",
				});
			}

			if (toDelete.size > 0) {
				await tx
					.delete(projectMember)
					.where(
						and(
							eq(projectMember.organizationId, tenant.organizationId),
							eq(projectMember.projectId, projectId),
							inArray(projectMember.userId, [...toDelete]),
						),
					);
				removed.push(...toDelete);
			}

			return toResults();
		},
	);

	// Access to this project is gone for every removed person. Fire and forget:
	// a Redis hiccup falls back to a local close and must never fail the batch.
	for (const userId of new Set(removed)) {
		void publishMemberRevocation({
			type: "revoke.member",
			organizationId: tenant.organizationId,
			userId,
			projectId,
		}).catch(() => undefined);
	}

	return { results };
}
