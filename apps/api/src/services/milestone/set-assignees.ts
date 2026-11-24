/**
 * Milestone assignee replacement endpoint.
 *
 * Why this file: the picker sends the full selection, so the write is a set
 * replacement rather than a patch. Isolating it means a lost assignee update
 * can never overwrite a body someone is typing.
 *
 * Used by: `routes/milestones.ts`.
 */

import { withTenant } from "../../db/tenant";
import { buildAssigneeEvents } from "../../lib/milestone-events";
import type { TenantContext } from "../../middleware/tenant";
import type { MilestoneChangedField } from "../../realtime/events";
import { createNotifications } from "../notification.service";
import {
	assertWritable,
	requireMilestoneRecord,
	requireProject,
} from "./access";
import {
	loadAssignees,
	replaceAssignees,
	resolveAssigneeMemberIds,
} from "./assignees";
import { loadDetail } from "./payload";
import { recordMilestoneEvents, toMilestoneTimeline } from "./timeline";
import type { MilestoneUpdateResult } from "./types";

/**
 * Replace the assignee set.
 *
 * Why its own endpoint: the picker sends the full selection, and keeping it
 * separate from the field patch means a lost assignee update can never
 * overwrite a body someone is typing.
 *
 * The timeline is built from the sets before and after the write, so it records
 * who was actually added or removed rather than trusting the request.
 */
export async function setMilestoneAssignees(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	userIds: string[],
): Promise<MilestoneUpdateResult> {
	const write = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertWritable(tenant, access);

			// The record must exist and belong to this project. Assignees stay
			// editable while the milestone is locked: handing work over is
			// progress, not a change to the agreed scope.
			await requireMilestoneRecord(tx, tenant, projectId, milestoneId);

			const previous =
				(await loadAssignees(tx, tenant, [milestoneId])).get(milestoneId) ?? [];
			const memberIds = await resolveAssigneeMemberIds(
				tx,
				tenant,
				projectId,
				userIds,
			);

			await replaceAssignees(tx, tenant, milestoneId, memberIds);

			const next =
				(await loadAssignees(tx, tenant, [milestoneId])).get(milestoneId) ?? [];
			const events = buildAssigneeEvents(previous, next);
			const eventRows = await recordMilestoneEvents(
				tx,
				tenant,
				milestoneId,
				events,
			);

			const detail = await loadDetail(
				tx,
				tenant,
				projectId,
				milestoneId,
				access,
			);
			const changed: MilestoneChangedField[] =
				events.length > 0 ? ["assignees"] : [];

			const beforeIds = new Set(previous.map((person) => person.userId));
			const addedUserIds = next
				.filter((person) => !beforeIds.has(person.userId))
				.map((person) => person.userId);
			const assigneeRowId =
				eventRows.find((row) => row.eventType === "assignee_added")?.id ?? null;
			const notifications = await createNotifications(
				tx,
				tenant,
				addedUserIds
					.filter((userId) => userId !== tenant.userId)
					.map((recipientUserId) => ({
						recipientUserId,
						actorUserId: tenant.userId,
						type: "milestone_assigned" as const,
						dedupeKey: `assign:${assigneeRowId ?? milestoneId}:${recipientUserId}`,
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

			return { detail, changed, eventRows, notifications };
		},
	);

	// The rows are mapped after the commit, so the extra user lookup never
	// extends the transaction.
	const timeline = await toMilestoneTimeline(write.eventRows, tenant);

	return {
		...write.detail,
		changed: write.changed,
		timeline,
		notifications: write.notifications,
	};
}
