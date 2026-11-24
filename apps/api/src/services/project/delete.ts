/**
 * Project deletion.
 *
 * Why this file: deleting a project has to walk every rich text body that owns
 * an attachment before the rows cascade, then remove the objects after the
 * commit. Keeping the delete and the object walk together makes that order
 * explicit.
 *
 * Used by: `routes/projects.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq, inArray } from "drizzle-orm";
import { canDeleteProject } from "../../auth/project-permissions";
import {
	changeRequest,
	comment,
	milestone,
	milestoneScopeEntry,
	project,
} from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { keyFromRichText } from "../../lib/storage";
import type { TenantContext } from "../../middleware/tenant";
import {
	deleteObjectsBestEffort,
	deletePreviousProjectLogo,
} from "../upload.service";
import { loadProjectAccess } from "./access";

/**
 * Permanently delete a project.
 *
 * Owner only. Memberships cascade with the row, and the logo and attachment
 * objects are removed after the database write succeeds.
 *
 * Why the extra reads before the delete: a project delete cascades to
 * milestones and comments, so the rows that reference an attachment are gone
 * the moment the project row is. The descriptions and comment bodies are
 * collected first, then the objects are removed after the commit.
 */
export async function deleteProject(
	tenant: TenantContext,
	projectId: string,
): Promise<{ status: "ok" }> {
	const { previousLogo, removedKeys } = await withTenant(
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

			const milestones = await tx
				.select({
					id: milestone.id,
					description: milestone.description,
				})
				.from(milestone)
				.where(
					and(
						eq(milestone.organizationId, tenant.organizationId),
						eq(milestone.projectId, projectId),
					),
				);

			// `inArray` with an empty list is not a valid predicate, so a project
			// with no milestones skips the comment read entirely.
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
				// Change requests carry attachments too, and they cascade with
				// the project, so their bodies are part of the same walk.
				tx
					.select({ body: changeRequest.body })
					.from(changeRequest)
					.where(
						and(
							eq(changeRequest.organizationId, tenant.organizationId),
							eq(changeRequest.projectId, projectId),
						),
					),
				// Named scope sections cascade with the project as well.
				tx
					.select({ body: milestoneScopeEntry.body })
					.from(milestoneScopeEntry)
					.where(
						and(
							eq(milestoneScopeEntry.organizationId, tenant.organizationId),
							eq(milestoneScopeEntry.projectId, projectId),
						),
					),
			]);

			const keys = keyFromRichText([
				...milestones.map((row) => row.description),
				...bodies.map((row) => row.body),
				...requestBodies.map((row) => row.body),
				...scopeBodies.map((row) => row.body),
			]);

			await tx
				.delete(project)
				.where(
					and(
						eq(project.organizationId, tenant.organizationId),
						eq(project.id, projectId),
					),
				);

			return { previousLogo: access.row.logo, removedKeys: keys };
		},
	);

	if (previousLogo) {
		await deletePreviousProjectLogo(tenant.organizationId, previousLogo);
	}

	await deleteObjectsBestEffort(removedKeys);

	return { status: "ok" };
}
