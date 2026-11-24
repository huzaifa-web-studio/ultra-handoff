/**
 * Project membership writes.
 *
 * Why this file: adding, re-roling and removing a member share the same
 * permission, duplicate and owner-count rules. Keeping them together means a
 * project can never lose its last owner through one path.
 *
 * Used by: `routes/projects.ts`, the bulk modules and
 * `services/member.service.ts`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { isOrganizationOwner } from "../../auth/permissions";
import {
	assertProjectActive,
	canAssignProjectRole,
	canManageProjectMembers,
	canManageProjectTarget,
	type ProjectRole,
} from "../../auth/project-permissions";
import { projectMember } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { publishMemberRevocation } from "../../realtime/bus";
import {
	createNotifications,
	type NotificationDelivery,
} from "../notification.service";
import {
	getOrganizationMember,
	listOrganizationOwners,
	type OrganizationMemberRecord,
} from "../organization.service";
import { loadProjectAccess } from "./access";
import { isUniqueViolation } from "./errors";
import { countOwners } from "./owners";

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
): Promise<{
	userId: string;
	role: ProjectRole;
	notifications: NotificationDelivery[];
}> {
	const forcedByOrganization = isOrganizationOwner(target.role);
	const finalRole: ProjectRole = forcedByOrganization ? "owner" : role;

	const notifications = await withTenant(
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

			const memberRowId = randomUUID();

			try {
				await tx.insert(projectMember).values({
					id: memberRowId,
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

			return createNotifications(tx, tenant, [
				{
					recipientUserId: target.userId,
					actorUserId: tenant.userId,
					type: "project_member_added",
					dedupeKey: `project_member:${memberRowId}`,
					project: {
						id: access.row.id,
						name: access.row.name,
						slug: access.row.slug,
					},
					data: { role: finalRole },
				},
			]);
		},
	);

	return {
		userId: target.userId,
		role: finalRole,
		notifications,
	};
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
): Promise<{
	userId: string;
	role: ProjectRole;
	notifications: NotificationDelivery[];
}> {
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
): Promise<{
	userId: string;
	role: ProjectRole;
	notifications: NotificationDelivery[];
}> {
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

	const notifications = await withTenant(
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

			return createNotifications(tx, tenant, [
				{
					recipientUserId: targetUserId,
					actorUserId: tenant.userId,
					type: "project_role_changed",
					dedupeKey: `project_role:${projectId}:${targetUserId}:${target.role}:${role}`,
					project: {
						id: access.row.id,
						name: access.row.name,
						slug: access.row.slug,
					},
					data: { role },
				},
			]);
		},
	);

	return { userId: targetUserId, role, notifications };
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

	// Access to this project is gone. Close the streams that person has open on
	// it; other projects in the workspace are untouched.
	void publishMemberRevocation({
		type: "revoke.member",
		organizationId: tenant.organizationId,
		userId: targetUserId,
		projectId,
	}).catch(() => undefined);

	return { status: "ok" };
}
