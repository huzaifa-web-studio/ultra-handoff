/**
 * Change request listing.
 *
 * Why this file: the list is the only read that filters by status and groups
 * the per status counts. Keeping both in one place keeps the chips honest.
 *
 * Used by: `routes/change-requests.ts`.
 */

import { and, desc, eq } from "drizzle-orm";
import { canDecideChangeRequest } from "../../auth/change-request-permissions";
import { changeRequest } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { requireMilestoneAccess } from "../milestone";
import {
	loadCounts,
	loadPeople,
	loadScopeEntryIds,
	loadTargetTitles,
	toChangeRequestRow,
} from "./payload";
import type { ChangeRequestListResult } from "./types";

/**
 * The list of change requests for one milestone.
 *
 * Deliberately unpaged: a milestone is a bounded piece of work, and the client
 * needs the whole picture, including the decided requests. The body is included,
 * because the detail pane expands a request in place instead of fetching it
 * again.
 */
export async function listChangeRequests(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<ChangeRequestListResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			const records = await tx
				.select()
				.from(changeRequest)
				.where(
					and(
						eq(changeRequest.organizationId, tenant.organizationId),
						eq(changeRequest.projectId, projectId),
						eq(changeRequest.milestoneId, milestoneId),
					),
				)
				.orderBy(desc(changeRequest.createdAt), desc(changeRequest.id));

			const [people, targetTitles, scopeEntryIds, counts] = await Promise.all([
				loadPeople(records),
				loadTargetTitles(tx, tenant, records),
				loadScopeEntryIds(tx, tenant, records),
				loadCounts(tx, tenant, milestoneId),
			]);

			return {
				projectId,
				milestoneId,
				changeRequests: records.map((record) =>
					toChangeRequestRow(
						record,
						people,
						targetTitles,
						scopeEntryIds,
						tenant.userId,
					),
				),
				counts,
				openCount: counts.open,
				canDecide:
					canDecideChangeRequest(tenant.role, access.role) &&
					access.row.archivedAt === null,
			};
		},
	);
}
