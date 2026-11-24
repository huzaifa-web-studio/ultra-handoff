/**
 * Bulk project actions.
 *
 * Why this file: bulk archive, restore and delete run the same per-item rules
 * as the single actions but report a partial result. Keeping them separate
 * from the single writes makes the result contract obvious.
 *
 * Used by: `routes/projects.ts`.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
	canDeleteProject,
	canEditProject,
} from "../../auth/project-permissions";
import {
	changeRequest,
	comment,
	milestone,
	milestoneScopeEntry,
	project,
} from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { BulkItemResult, BulkResult } from "../../lib/bulk-result";
import { keyFromRichText } from "../../lib/storage";
import type { TenantContext } from "../../middleware/tenant";
import {
	createNotifications,
	loadProjectManagerUserIds,
	loadProjectMemberUserIds,
	type NotificationCandidate,
	type NotificationDelivery,
} from "../notification.service";
import { listOrganizationOwners } from "../organization.service";
import {
	deleteObjectsBestEffort,
	deletePreviousProjectLogo,
} from "../upload.service";
import { loadProjectAccessMany } from "./access";

/**
 * Archive or restore several projects in one request.
 *
 * Why one transaction and one update: the single item path opens a transaction
 * and repeats the access query per project, so a 100 item action meant 100
 * sequential transactions. This reads every access decision once, decides each
 * item's outcome from that read, and updates only the projects whose state
 * actually changes. The per item result contract is unchanged.
 */
export async function bulkSetProjectsArchived(
	tenant: TenantContext,
	projectIds: string[],
	archived: boolean,
): Promise<BulkResult & { notifications: NotificationDelivery[] }> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccessMany(tx, tenant, projectIds);
			const results: BulkItemResult[] = [];
			const toUpdate = new Set<string>();

			for (const projectId of projectIds) {
				const found = access.get(projectId);

				if (!found) {
					results.push({
						key: projectId,
						label: projectId,
						status: "skipped",
						message: "That project no longer exists.",
					});
					continue;
				}

				if (!canEditProject(tenant.role, found.role)) {
					results.push({
						key: projectId,
						label: found.row.name,
						status: "skipped",
						message:
							"Only project owners and admins can archive or restore a project.",
					});
					continue;
				}

				// Idempotent, exactly like the single call: an already archived
				// project is still reported as archived.
				if ((found.row.archivedAt !== null) !== archived) {
					toUpdate.add(projectId);
				}

				results.push({
					key: projectId,
					label: found.row.name,
					status: archived ? "archived" : "restored",
					message: archived ? "Project archived." : "Project restored.",
				});
			}

			if (toUpdate.size > 0) {
				await tx
					.update(project)
					.set({ archivedAt: archived ? new Date() : null })
					.where(
						and(
							eq(project.organizationId, tenant.organizationId),
							inArray(project.id, [...toUpdate]),
						),
					);
			}

			const candidates: NotificationCandidate[] = [];
			const organizationOwners = archived
				? []
				: await listOrganizationOwners(tenant.organizationId);

			for (const projectId of toUpdate) {
				const found = access.get(projectId);

				if (!found) continue;

				const recipients = new Set<string>();

				if (archived) {
					for (const userId of await loadProjectManagerUserIds(
						tx,
						tenant,
						projectId,
					)) {
						recipients.add(userId);
					}

					if (found.row.archiveVisibleToClient) {
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

					for (const owner of organizationOwners) {
						recipients.add(owner.userId);
					}
				}

				for (const recipientUserId of recipients) {
					if (recipientUserId === tenant.userId) continue;

					candidates.push({
						recipientUserId,
						actorUserId: tenant.userId,
						type: archived ? "project_archived" : "project_unarchived",
						dedupeKey: `${archived ? "archive" : "restore"}:${projectId}:${recipientUserId}:${randomUUID()}`,
						project: {
							id: found.row.id,
							name: found.row.name,
							slug: found.row.slug,
						},
					});
				}
			}

			const notifications = await createNotifications(tx, tenant, candidates);

			return { results, notifications };
		},
	);
}

/**
 * Permanently delete several projects in one request.
 *
 * One transaction, one access read and one delete statement. The owner check,
 * the cascade and the logo and attachment cleanup are the same rules the single
 * delete enforces, but the attachment rows for the whole selection are read
 * before the delete and the objects are removed after the commit.
 */
export async function bulkDeleteProjects(
	tenant: TenantContext,
	projectIds: string[],
): Promise<BulkResult> {
	const { results, previousLogos, removedKeys } = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccessMany(tx, tenant, projectIds);
			const results: BulkItemResult[] = [];
			const toDelete: string[] = [];

			for (const projectId of projectIds) {
				const found = access.get(projectId);

				if (!found) {
					results.push({
						key: projectId,
						label: projectId,
						status: "skipped",
						message: "That project no longer exists.",
					});
					continue;
				}

				if (!canDeleteProject(tenant.role, found.role)) {
					results.push({
						key: projectId,
						label: found.row.name,
						status: "skipped",
						message: "Only a project owner can delete a project.",
					});
					continue;
				}

				toDelete.push(projectId);
				results.push({
					key: projectId,
					label: found.row.name,
					status: "deleted",
					message: "Project deleted.",
				});
			}

			if (toDelete.length === 0) {
				return { results, previousLogos: [], removedKeys: [] };
			}

			// A project delete cascades to milestones and comments, so the rows
			// that reference an attachment are gone the moment the project row
			// is. Read every description and body first, for all projects.
			const milestones = await tx
				.select({ id: milestone.id, description: milestone.description })
				.from(milestone)
				.where(
					and(
						eq(milestone.organizationId, tenant.organizationId),
						inArray(milestone.projectId, toDelete),
					),
				);

			const milestoneIds = milestones.map((row) => row.id);
			const [bodies, requestBodies, scopeBodies] = await Promise.all([
				milestoneIds.length === 0
					? []
					: tx
							.select({ body: comment.body })
							.from(comment)
							.where(
								and(
									eq(comment.organizationId, tenant.organizationId),
									inArray(comment.milestoneId, milestoneIds),
								),
							),
				tx
					.select({ body: changeRequest.body })
					.from(changeRequest)
					.where(
						and(
							eq(changeRequest.organizationId, tenant.organizationId),
							inArray(changeRequest.projectId, toDelete),
						),
					),
				tx
					.select({ body: milestoneScopeEntry.body })
					.from(milestoneScopeEntry)
					.where(
						and(
							eq(milestoneScopeEntry.organizationId, tenant.organizationId),
							inArray(milestoneScopeEntry.projectId, toDelete),
						),
					),
			]);

			const removedKeys = keyFromRichText([
				...milestones.map((row) => row.description),
				...bodies.map((row) => row.body),
				...requestBodies.map((row) => row.body),
				...scopeBodies.map((row) => row.body),
			]);

			// Deduplicate logos: a duplicated id in the request must not delete
			// the same object twice.
			const previousLogos = [
				...new Set(
					toDelete
						.map((projectId) => access.get(projectId)?.row.logo)
						.filter((logo): logo is string => Boolean(logo)),
				),
			];

			await tx
				.delete(project)
				.where(
					and(
						eq(project.organizationId, tenant.organizationId),
						inArray(project.id, toDelete),
					),
				);

			return { results, previousLogos, removedKeys };
		},
	);

	// Cleanup runs after the commit, exactly like the single delete.
	for (const logo of previousLogos) {
		await deletePreviousProjectLogo(tenant.organizationId, logo);
	}

	await deleteObjectsBestEffort(removedKeys);

	return { results };
}
