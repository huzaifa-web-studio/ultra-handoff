/**
 * Move a change request into a milestone.
 *
 * Why this file: the move creates a milestone and marks the request moved in
 * one transaction, so a failure cannot leave a milestone behind. It is the only
 * path that calls both services together.
 *
 * Used by: `routes/change-requests.ts`.
 */

import { APIError } from "better-auth/api";
import { canDecideChangeRequest } from "../../auth/change-request-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { changeRequest } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { queueDocumentPreviews } from "../link-preview.service";
import {
	insertMilestone,
	recordMilestoneEvents,
	requireMilestoneAccess,
	toMilestoneTimeline,
} from "../milestone";
import { createNotifications } from "../notification.service";
import { changeRequestScope, requireChangeRequestRecord } from "./access";
import { buildEvent } from "./events";
import { toWriteShape } from "./payload";
import type { ChangeRequestMoveResult, MoveChangeRequestInput } from "./types";

/**
 * Turn a request into a new milestone in the same project.
 *
 * The source milestone is never touched, so this works while it is locked. The
 * new milestone and the moved request are written in one transaction, which is
 * what stops a failure from leaving a milestone nobody asked for.
 */
export async function moveChangeRequestToMilestone(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	changeRequestId: string,
	input: MoveChangeRequestInput,
): Promise<ChangeRequestMoveResult> {
	const write = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			assertProjectActive(access.row.archivedAt);

			if (!canDecideChangeRequest(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message: "Only staff can move a change request.",
				});
			}

			const record = await requireChangeRequestRecord(
				tx,
				tenant,
				milestoneId,
				changeRequestId,
				{ forUpdate: true },
			);

			if (record.status !== "open") {
				throw new APIError("BAD_REQUEST", {
					message: "This change request has already been decided.",
				});
			}

			const created = await insertMilestone(
				tx,
				tenant,
				access,
				projectId,
				{
					title: input.title ?? record.title,
					description: input.description ?? record.body,
					status: input.status,
					statusNote: input.statusNote,
					startDate: input.startDate,
					dueDate: input.dueDate,
					estimateMinutes: input.estimateMinutes,
					assigneeUserIds: input.assigneeUserIds,
				},
				// A body copied from the request was validated when it was
				// stored. A body edited in the move dialog is new and is checked.
				{ trustedBody: input.description === undefined },
			);

			await tx
				.update(changeRequest)
				.set({
					status: "moved",
					targetMilestoneId: created.milestone.id,
					decidedBy: tenant.userId,
					decidedAt: new Date(),
					decisionNote: null,
				})
				.where(changeRequestScope(tenant, milestoneId, changeRequestId));

			const updated = await requireChangeRequestRecord(
				tx,
				tenant,
				milestoneId,
				changeRequestId,
			);

			const eventRows = await recordMilestoneEvents(tx, tenant, milestoneId, [
				buildEvent(
					"change_request_moved",
					record.title,
					created.milestone.title,
				),
			]);

			const alreadyNotified = new Set(
				created.notifications.map((delivery) => delivery.recipientUserId),
			);
			const decisionNotifications =
				record.requestedBy &&
				record.requestedBy !== tenant.userId &&
				!alreadyNotified.has(record.requestedBy)
					? await createNotifications(tx, tenant, [
							{
								recipientUserId: record.requestedBy,
								actorUserId: tenant.userId,
								type: "change_request_decided",
								dedupeKey: `cr_decided:${changeRequestId}:moved:${record.requestedBy}`,
								project: {
									id: access.row.id,
									name: access.row.name,
									slug: access.row.slug,
								},
								milestone: {
									id: milestoneId,
									title: created.milestone.title,
								},
								changeRequest: {
									id: updated.id,
									title: updated.title,
								},
								data: { decision: "moved" },
							},
						])
					: [];

			return {
				...(await toWriteShape(tx, tenant, milestoneId, updated)),
				scopeEntry: null,
				eventRows,
				created,
				notifications: [...created.notifications, ...decisionNotifications],
			};
		},
	);

	// Enrichment only, after the commit, exactly like a normal milestone create.
	void queueDocumentPreviews(tenant, write.created.milestone.description).catch(
		() => undefined,
	);

	const timeline = await toMilestoneTimeline(write.eventRows, tenant);

	return {
		changeRequest: write.changeRequest,
		milestone: write.created.milestone,
		openCount: write.openCount,
		scopeEntry: null,
		timeline,
		notifications: write.notifications,
	};
}
