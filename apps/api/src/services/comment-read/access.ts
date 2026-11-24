/**
 * Comment read access guard.
 *
 * Why this file: marking a thread read starts from the same project access
 * check as every other comment read, so it lives on its own.
 *
 * Used by: `mark.ts`.
 */

import { APIError } from "better-auth/api";
import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { loadProjectAccess } from "../project";

/** Ask the project service for access without duplicating its rules. */
export async function requireProjectAccess(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
): Promise<{ projectId: string }> {
	const access = await loadProjectAccess(tx, tenant, projectId);

	if (!access) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}

	return { projectId: access.row.id };
}
