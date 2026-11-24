/**
 * Milestone lock and unlock endpoint.
 *
 * Why this file: lock and unlock share every rule (owner or admin, active
 * project, one timeline row, one broadcast), so they share one internal helper
 * and only the entry points differ.
 *
 * Used by: `routes/milestones.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import {
	canLockMilestones,
	validateMilestoneNote,
} from "../../auth/milestone-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { milestone } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import {
	createNotifications,
	loadMilestoneAssigneeUserIds,
	loadProjectMemberUserIds,
} from "../notification.service";
import { requireMilestoneRecordForUpdate, requireProject } from "./access";
import { loadDetail } from "./payload";
import { recordMilestoneEvents, toMilestoneTimeline } from "./timeline";
import type { MilestoneUpdateResult } from "./types";

/**
 * Lock or unlock one milestone.
 *
 * Why one internal helper with a boolean: lock and unlock share every rule
 * (owner or admin, active project, one timeline row, one broadcast), so the two
 * public functions are just named entry points. The lock is not tied to a
 * status; it is an explicit decision about the agreed baseline.
 */
async function setMilestoneLock(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	locked: boolean,
	reason: string | null | undefined,
): Promise<MilestoneUpdateResult> {
	const note = validateMilestoneNote(
		reason,
		locked ? "The lock reason" : "The unlock reason",
	);

	const write = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertProjectActive(access.row.archivedAt);

			if (!canLockMilestones(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message:
						"Only a project owner or admin can lock or unlock a milestone.",
				});
			}

			const record = await requireMilestoneRecordForUpdate(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			// Repeating the action is a mistake, not a no-op. Saying so is
			// clearer than silently moving the timestamp and the timeline.
			if (locked && record.lockedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "This milestone is already locked.",
				});
			}

			if (!locked && record.lockedAt === null) {
				throw new APIError("BAD_REQUEST", {
					message: "This milestone is not locked.",
				});
			}

			await tx
				.update(milestone)
				.set({
					lockedAt: locked ? new Date() : null,
					lockedBy: locked ? tenant.userId : null,
					updatedBy: tenant.userId,
				})
				.where(
					and(
						eq(milestone.organizationId, tenant.organizationId),
						eq(milestone.projectId, projectId),
						eq(milestone.id, milestoneId),
					),
				);

			const eventRows = await recordMilestoneEvents(tx, tenant, milestoneId, [
				{
					type: locked ? "milestone_locked" : "milestone_unlocked",
					from: null,
					to: null,
					note,
				},
			]);

			const detail = await loadDetail(
				tx,
				tenant,
				projectId,
				milestoneId,
				access,
			);

			const recipients = new Set([
				...(await loadMilestoneAssigneeUserIds(tx, tenant, milestoneId)),
				...(await loadProjectMemberUserIds(tx, tenant, projectId, ["client"])),
			]);
			const eventRowId = eventRows[0]?.id ?? milestoneId;

			const notifications = await createNotifications(
				tx,
				tenant,
				[...recipients]
					.filter((userId) => userId !== tenant.userId)
					.map((recipientUserId) => ({
						recipientUserId,
						actorUserId: tenant.userId,
						type: locked
							? ("scope_locked" as const)
							: ("scope_unlocked" as const),
						dedupeKey: `${locked ? "lock" : "unlock"}:${eventRowId}:${recipientUserId}`,
						project: {
							id: access.row.id,
							name: access.row.name,
							slug: access.row.slug,
						},
						milestone: {
							id: milestoneId,
							title: detail.milestone.title,
						},
					})),
			);

			return { detail, eventRows, notifications };
		},
	);

	const timeline = await toMilestoneTimeline(write.eventRows, tenant);

	return {
		...write.detail,
		changed: ["lock"],
		timeline,
		notifications: write.notifications,
	};
}

/** Lock a milestone. Owner or admin only. */
export async function lockMilestone(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	reason?: string | null,
): Promise<MilestoneUpdateResult> {
	return setMilestoneLock(tenant, projectId, milestoneId, true, reason);
}

/** Unlock a milestone. Owner or admin only. The reason is optional. */
export async function unlockMilestone(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	reason?: string | null,
): Promise<MilestoneUpdateResult> {
	return setMilestoneLock(tenant, projectId, milestoneId, false, reason);
}
