/**
 * Milestone creation.
 *
 * Why this file: creating a milestone writes the row, its assignees, its first
 * status period and its first activity rows together. Keeping the whole write
 * in one transaction is what makes a half-created milestone impossible.
 *
 * `insertMilestone` is exported separately because turning a change request
 * into a milestone has to create the milestone and mark the request moved in
 * the same transaction. Both paths therefore validate and write a milestone the
 * same way.
 *
 * Used by: `routes/milestones.ts` and `change-request/`.
 */

import { randomUUID } from "node:crypto";

import { APIError } from "better-auth/api";

import {
	milestoneStatusAcceptsNote,
	milestoneStatusNeedsNote,
	validateMilestoneDate,
	validateMilestoneDateRange,
	validateMilestoneEstimate,
	validateMilestoneNote,
	validateMilestoneStatus,
	validateMilestoneTitle,
} from "../../auth/milestone-permissions";
import { milestone } from "../../db/schema";
import { type TenantTx, withTenant } from "../../db/tenant";
import { sanitizeRichText } from "../../lib/rich-text";
import type { TenantContext } from "../../middleware/tenant";
import { queueDocumentPreviews } from "../link-preview.service";
import { assertCommentMentions } from "../mention.service";
import { createPhaseRoundEntry } from "../milestone/scope";
import { openStatusPeriod } from "../milestone-phase.service";
import {
	createNotifications,
	type NotificationCandidate,
} from "../notification.service";
import type { ProjectAccess } from "../project";
import { assertWritable, requireProject } from "./access";
import {
	loadAssignees,
	replaceAssignees,
	resolveAssigneeMemberIds,
} from "./assignees";
import { loadDetail, mentionedUserIds } from "./payload";
import { recordMilestoneEvents } from "./timeline";
import type { CreateMilestoneInput, MilestoneWriteResult } from "./types";

/**
 * Insert one milestone inside an existing transaction.
 *
 * Why exported and separate from `createMilestone`: turning a change request
 * into a milestone has to create the milestone and mark the request moved in
 * the same transaction, otherwise a failure between the two leaves a milestone
 * nobody asked for. Sharing this helper means both paths validate and write a
 * milestone the same way.
 *
 * `trustedBody` skips the mention access check for a body that was already
 * validated when it was stored, which is what the move flow passes. A mention
 * of someone who left the project must not block an otherwise valid move.
 */
export async function insertMilestone(
	tx: TenantTx,
	tenant: TenantContext,
	access: ProjectAccess,
	projectId: string,
	input: CreateMilestoneInput,
	options: { trustedBody?: boolean } = {},
): Promise<MilestoneWriteResult> {
	const title = validateMilestoneTitle(input.title);
	const status = input.status ? validateMilestoneStatus(input.status) : "todo";
	const startDate = validateMilestoneDate(input.startDate, "The start date");
	const dueDate = validateMilestoneDate(input.dueDate, "The due date");

	validateMilestoneDateRange(startDate, dueDate);

	const estimateMinutes = validateMilestoneEstimate(input.estimateMinutes);
	const description = sanitizeRichText(input.description);
	const statusNote = validateMilestoneNote(
		input.statusNote,
		status === "cancelled" ? "The cancellation reason" : "The blocked reason",
	);
	const milestoneId = randomUUID();

	// A milestone created already blocked still needs a reason. The rule is
	// about the status, not about which endpoint set it.
	if (milestoneStatusNeedsNote(status) && !statusNote) {
		throw new APIError("BAD_REQUEST", {
			message: "Say why this milestone is blocked.",
		});
	}

	if (!options.trustedBody) {
		await assertCommentMentions(tx, tenant, projectId, description.value);
	}

	// Resolve assignees before the insert, so a bad assignee fails the whole
	// request instead of leaving a milestone behind.
	const memberIds = input.assigneeUserIds
		? await resolveAssigneeMemberIds(
				tx,
				tenant,
				projectId,
				input.assigneeUserIds,
			)
		: [];

	await tx.insert(milestone).values({
		id: milestoneId,
		organizationId: tenant.organizationId,
		projectId,
		title,
		status,
		description: description.value,
		descriptionText: description.text,
		startDate,
		dueDate,
		estimateMinutes,
		completedAt: status === "done" ? new Date() : null,
		createdBy: tenant.userId,
		updatedBy: tenant.userId,
	});

	await replaceAssignees(tx, tenant, milestoneId, memberIds);

	// Every milestone starts with an open period, so its first phase can be
	// measured from the same point the rest of the timeline starts.
	const period = await openStatusPeriod(tx, tenant, {
		projectId,
		milestoneId,
		status,
		note: statusNote,
	});

	// A milestone created directly in testing or review owns the first round
	// for that visit, exactly as a status change would have created it.
	if (status === "in_testing" || status === "in_review") {
		await createPhaseRoundEntry(tx, tenant, {
			projectId,
			milestoneId,
			kind: status === "in_testing" ? "test" : "review",
			statusPeriodId: period.id,
		});
	}

	// A milestone that starts blocked or cancelled keeps its reason on the
	// timeline, so a reader is not left asking why work stopped on day one.
	if (statusNote && milestoneStatusAcceptsNote(status)) {
		await recordMilestoneEvents(tx, tenant, milestoneId, [
			{ type: "status", from: null, to: status, note: statusNote },
		]);
	}

	const detail = await loadDetail(tx, tenant, projectId, milestoneId, access);
	const assigned =
		(await loadAssignees(tx, tenant, [milestoneId])).get(milestoneId) ?? [];
	const noticeByUser = new Map<string, "mention" | "milestone_assigned">();

	for (const userId of mentionedUserIds(description.value)) {
		noticeByUser.set(userId, "mention");
	}

	for (const assignee of assigned) {
		if (!noticeByUser.has(assignee.userId)) {
			noticeByUser.set(assignee.userId, "milestone_assigned");
		}
	}

	const projectView = {
		id: access.row.id,
		name: access.row.name,
		slug: access.row.slug,
	};
	const milestoneView = { id: milestoneId, title };

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
							? `mention:milestone:${milestoneId}:${recipientUserId}:initial`
							: `assign:milestone:${milestoneId}:${recipientUserId}:initial`,
					project: projectView,
					milestone: milestoneView,
				}),
			),
	);

	return { ...detail, notifications };
}

/** Create a milestone, optionally with its first assignees. */
export async function createMilestone(
	tenant: TenantContext,
	projectId: string,
	input: CreateMilestoneInput,
): Promise<MilestoneWriteResult> {
	const result = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertWritable(tenant, access);

			return insertMilestone(tx, tenant, access, projectId, input);
		},
	);

	// Enrichment only. A queue or Redis failure must never fail the save, so
	// this runs after the transaction commits and its rejection is swallowed.
	void queueDocumentPreviews(tenant, result.milestone.description).catch(
		() => undefined,
	);

	return result;
}
