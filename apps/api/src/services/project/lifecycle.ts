/**
 * Project lifecycle writes.
 *
 * Why this file: create, update and archive are the writes that change what a
 * project is. They share the slug rules, the access checks and the archive
 * notification, so they belong together.
 *
 * Used by: `routes/projects.ts`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import {
	assertProjectActive,
	canCreateProject,
	canEditProject,
	validateProjectDescription,
	validateProjectName,
	validateProjectSlug,
} from "../../auth/project-permissions";
import { project, projectMember } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { setProjectRoomArchived } from "../conversation/project";
import {
	createNotifications,
	loadProjectManagerUserIds,
	loadProjectMemberUserIds,
	type NotificationDelivery,
} from "../notification.service";
import { listOrganizationOwners } from "../organization.service";
import { deletePreviousProjectLogo } from "../upload.service";
import { loadProjectAccess } from "./access";
import { getProjectDetail } from "./detail";
import { isUniqueViolation } from "./errors";
import { normalizeLogo } from "./payload";
import type {
	CreateProjectInput,
	ProjectDetail,
	ProjectStatus,
	UpdateProjectInput,
} from "./types";

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
): Promise<{
	status: ProjectStatus;
	archivedAt: string | null;
	notifications: NotificationDelivery[];
}> {
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
					notifications: [] as NotificationDelivery[],
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

			// A project room is read only while its project is archived.
			await setProjectRoomArchived(
				tx,
				tenant.organizationId,
				projectId,
				archivedAt,
			);

			const recipients = new Set<string>();

			if (archived) {
				for (const userId of await loadProjectManagerUserIds(
					tx,
					tenant,
					projectId,
				)) {
					recipients.add(userId);
				}

				// A client keeps seeing the archived project only when the
				// project opted in. Notifying anyone else would create a link
				// they cannot open and a row the list filters out immediately.
				if (access.row.archiveVisibleToClient) {
					for (const userId of await loadProjectMemberUserIds(
						tx,
						tenant,
						projectId,
						["client"],
					)) {
						recipients.add(userId);
					}
				}
			} else {
				for (const userId of await loadProjectMemberUserIds(
					tx,
					tenant,
					projectId,
				)) {
					recipients.add(userId);
				}

				for (const owner of await listOrganizationOwners(
					tenant.organizationId,
				)) {
					recipients.add(owner.userId);
				}
			}

			const notifications = await createNotifications(
				tx,
				tenant,
				[...recipients]
					.filter((userId) => userId !== tenant.userId)
					.map((recipientUserId) => ({
						recipientUserId,
						actorUserId: tenant.userId,
						type: archived
							? ("project_archived" as const)
							: ("project_unarchived" as const),
						// The service already no-ops a repeated state, so a
						// random key is safe and lets a later real transition
						// notify again.
						dedupeKey: `${archived ? "archive" : "restore"}:${projectId}:${recipientUserId}:${randomUUID()}`,
						project: {
							id: access.row.id,
							name: access.row.name,
							slug: access.row.slug,
						},
					})),
			);

			return {
				status: archived ? "archived" : "active",
				archivedAt: archivedAt ? archivedAt.toISOString() : null,
				notifications,
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
