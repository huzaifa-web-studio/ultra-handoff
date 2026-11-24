/**
 * Change request scope and access.
 *
 * Why this file: every read and write starts from the same milestone access
 * check and the same organization scope, and the per status counts share one
 * shape. Keeping them here means no path can skip the boundary.
 *
 * Used by: the read and write modules in `services/change-request/`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import type { ChangeRequestStatus } from "../../auth/change-request-permissions";
import { changeRequest } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import type { ChangeRequestRecord } from "./types";

/** Every status initialized to zero, so the UI never has to guess. */
export function emptyCounts(): Record<ChangeRequestStatus, number> {
	return {
		open: 0,
		accepted: 0,
		declined: 0,
		moved: 0,
		withdrawn: 0,
	};
}

/** The scope every single request read or write uses. */
export function changeRequestScope(
	tenant: TenantContext,
	milestoneId: string,
	changeRequestId: string,
) {
	return and(
		eq(changeRequest.organizationId, tenant.organizationId),
		eq(changeRequest.milestoneId, milestoneId),
		eq(changeRequest.id, changeRequestId),
	);
}

/** Load one request inside one milestone, or fail with 404. */
export async function requireChangeRequestRecord(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	changeRequestId: string,
	options: { forUpdate?: boolean } = {},
): Promise<ChangeRequestRecord> {
	const query = tx
		.select()
		.from(changeRequest)
		.where(changeRequestScope(tenant, milestoneId, changeRequestId))
		.limit(1);

	const [record] = options.forUpdate ? await query.for("update") : await query;

	if (!record) {
		throw new APIError("NOT_FOUND", {
			message: "That change request no longer exists.",
		});
	}

	return record;
}
