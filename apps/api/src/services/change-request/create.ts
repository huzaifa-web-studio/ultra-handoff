/**
 * New change requests.
 *
 * Why this file: raising a request writes the row, its initial scope entry and
 * the notifications in one transaction. Those steps belong together.
 *
 * Used by: `routes/change-requests.ts`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import {
	canCreateChangeRequest,
	validateChangeRequestTitle,
} from "../../auth/change-request-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { changeRequest } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { sanitizeOptionalCommentBody } from "../../lib/rich-text";
import type { TenantContext } from "../../middleware/tenant";
import { assertCommentMentions } from "../mention.service";
import {
	recordMilestoneEvents,
	requireMilestoneAccess,
	toMilestoneTimeline,
} from "../milestone";
import {
	createNotifications,
	loadMilestoneAssigneeUserIds,
	loadProjectManagerUserIds,
	type NotificationCandidate,
} from "../notification.service";
import { buildEvent } from "./events";
import { mentionedUserIds } from "./mentions";
import { toWriteShape } from "./payload";
import type {
	ChangeRequestWriteResult,
	CreateChangeRequestInput,
} from "./types";

/**
 * Raise a change request.
 *
 * Anyone on the project may ask, including the client, and the milestone lock
 * never blocks the ask.
 */
export async function createChangeRequest(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	input: CreateChangeRequestInput,
): Promise<ChangeRequestWriteResult> {
	const title = validateChangeRequestTitle(input.title);
	const body = sanitizeOptionalCommentBody(input.body);

	const write = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const { access, milestone } = await requireMilestoneAccess(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			assertProjectActive(access.row.archivedAt);

			if (!canCreateChangeRequest(tenant.role, access.role)) {
				throw new APIError("FORBIDDEN", {
					message: "You can read this milestone but not request changes to it.",
				});
			}

			await assertCommentMentions(tx, tenant, projectId, body.value);

			const [record] = await tx
				.insert(changeRequest)
				.values({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					projectId,
					milestoneId,
					title,
					body: body.value,
					bodyText: body.text,
					status: "open",
					requestedBy: tenant.userId,
				})
				.returning();

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That change request could not be read back.",
				});
			}

			const eventRows = await recordMilestoneEvents(tx, tenant, milestoneId, [
				buildEvent("change_request_created", title),
			]);

			const recipients = new Set([
				...(await loadProjectManagerUserIds(tx, tenant, projectId)),
				...(await loadMilestoneAssigneeUserIds(tx, tenant, milestoneId)),
			]);
			const noticeByUser = new Map<
				string,
				"mention" | "change_request_created"
			>();

			for (const userId of mentionedUserIds(body.value)) {
				noticeByUser.set(userId, "mention");
			}

			for (const userId of recipients) {
				if (!noticeByUser.has(userId)) {
					noticeByUser.set(userId, "change_request_created");
				}
			}

			const notifications = await createNotifications(
				tx,
				tenant,
				[...noticeByUser.entries()]
					.filter(([userId]) => userId !== tenant.userId)
					.map(
						([recipientUserId, type]): NotificationCandidate => ({
							recipientUserId,
							actorUserId: tenant.userId,
							type,
							dedupeKey:
								type === "mention"
									? `mention:change:${record.id}:${recipientUserId}`
									: `cr_created:${record.id}:${recipientUserId}`,
							project: {
								id: access.row.id,
								name: access.row.name,
								slug: access.row.slug,
							},
							milestone: {
								id: milestone.id,
								title: milestone.title,
							},
							changeRequest: {
								id: record.id,
								title: record.title,
							},
							...(type === "mention" ? {} : {}),
						}),
					),
			);

			return {
				...(await toWriteShape(tx, tenant, milestoneId, record)),
				scopeEntry: null,
				eventRows,
				notifications,
			};
		},
	);

	const timeline = await toMilestoneTimeline(write.eventRows, tenant);

	return {
		changeRequest: write.changeRequest,
		openCount: write.openCount,
		scopeEntry: null,
		timeline,
		notifications: write.notifications,
	};
}
