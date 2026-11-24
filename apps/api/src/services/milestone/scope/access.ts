/**
 * Scope access guards.
 *
 * Why this file: every scope write starts from the same project and milestone
 * checks, so they live together.
 *
 * Used by: `update.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { milestone } from "../../../db/schema";
import type { TenantTx } from "../../../db/tenant";
import type { TenantContext } from "../../../middleware/tenant";
import { loadProjectAccess } from "../../project";

/** Load project access or fail with 404, matching every milestone surface. */
export async function requireProjectAccess(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
) {
	const access = await loadProjectAccess(tx, tenant, projectId);

	if (!access) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}

	return access;
}

/** Reject a milestone id that does not belong to the project. */
export async function requireMilestoneRecord(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
) {
	const [record] = await tx
		.select()
		.from(milestone)
		.where(
			and(
				eq(milestone.organizationId, tenant.organizationId),
				eq(milestone.projectId, projectId),
				eq(milestone.id, milestoneId),
			),
		)
		.limit(1);

	if (!record) {
		throw new APIError("NOT_FOUND", {
			message: "That milestone no longer exists.",
		});
	}

	return record;
}
