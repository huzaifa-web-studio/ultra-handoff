/**
 * Milestone scope checklist endpoint.
 *
 * Why this file: a checklist tick is the one write that survives the document
 * lock. Keeping it separate from the field patch makes that exception explicit.
 *
 * Used by: `routes/milestones.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { canWriteMilestones } from "../../auth/milestone-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { milestone } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { findChecklistItem } from "../../lib/checklist";
import type { TenantContext } from "../../middleware/tenant";
import { requireMilestoneRecordForUpdate, requireProject } from "./access";
import { loadDetail } from "./payload";
import type {
	MilestoneDetailResult,
	ToggleMilestoneChecklistInput,
} from "./types";

/**
 * Flip one scope checklist item.
 *
 * Why its own endpoint: the lock freezes the document, but ticking an item is
 * progress against the document rather than a change to the agreed text. This
 * is the one write that survives the lock.
 *
 * The row is locked before the read-modify-write, so two people ticking two
 * different items at the same moment cannot drop each other's change. No
 * timeline row is written: a checklist produces many ticks and the discussion
 * is for decisions, not progress noise.
 */
export async function toggleMilestoneChecklist(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	input: ToggleMilestoneChecklistInput,
): Promise<MilestoneDetailResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertProjectActive(access.row.archivedAt);

			// A tick is progress on the agency's plan, so it follows the same
			// role rule as editing and not the client review rule.
			if (!canWriteMilestones(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message: "You can review milestones but not change them.",
				});
			}

			const record = await requireMilestoneRecordForUpdate(
				tx,
				tenant,
				projectId,
				milestoneId,
			);
			const body = structuredClone(record.description);
			const item = findChecklistItem(body, input.itemId);

			if (!item) {
				throw new APIError("NOT_FOUND", {
					message: "That checklist item no longer exists.",
				});
			}

			// A tap that matches the stored state is a no-op, so `updatedAt`
			// and every open editor stay still.
			if (item.checked !== input.checked) {
				item.checked = input.checked;

				await tx
					.update(milestone)
					.set({
						description: body,
						// The text mirror does not change: a tick is not text.
						updatedBy: tenant.userId,
					})
					.where(
						and(
							eq(milestone.organizationId, tenant.organizationId),
							eq(milestone.projectId, projectId),
							eq(milestone.id, milestoneId),
						),
					);
			}

			return loadDetail(tx, tenant, projectId, milestoneId, access);
		},
	);
}
