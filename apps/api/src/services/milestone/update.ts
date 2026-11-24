/**
 * Milestone field updates.
 *
 * Why this file: this is the endpoint autosave calls, and it is the only path
 * that can change several milestone fields in one request. Field validation,
 * the lock rules, the activity rows and the notifications all have to agree
 * inside one transaction, so they live here together.
 *
 * A status change is the one patch that also writes a status period and a
 * scope round. It locks the milestone row to serialize two people changing it
 * at once. Every other field stays lock free, so two tabs editing different
 * fields never wait on each other.
 *
 * Used by: `routes/milestones.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import {
	MILESTONE_LOCKED_MESSAGE,
	milestoneStatusNeedsNote,
	validateMilestoneDate,
	validateMilestoneDateRange,
	validateMilestoneEstimate,
	validateMilestoneNote,
	validateMilestoneStatus,
	validateMilestoneTitle,
} from "../../auth/milestone-permissions";
import { milestone } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import {
	buildAssigneeEvents,
	buildEstimateEvent,
	type MilestoneEventDraft,
} from "../../lib/milestone-events";
import { sanitizeRichText } from "../../lib/rich-text";
import type { TenantContext } from "../../middleware/tenant";
import type { MilestoneChangedField } from "../../realtime/events";
import { queueDocumentPreviews } from "../link-preview.service";
import { assertCommentMentions } from "../mention.service";
import {
	closeOpenStatusPeriod,
	openStatusPeriod,
} from "../milestone-phase.service";
import { createPhaseRoundEntry } from "../milestone-scope.service";
import {
	createNotifications,
	loadMilestoneAssigneeUserIds,
	loadProjectMemberUserIds,
	type NotificationCandidate,
} from "../notification.service";
import {
	assertWritable,
	requireMilestoneRecord,
	requireMilestoneRecordForUpdate,
	requireProject,
} from "./access";
import {
	loadAssignees,
	replaceAssignees,
	resolveAssigneeMemberIds,
} from "./assignees";
import { loadDetail, mentionedUserIds, toIsoDay } from "./payload";
import { recordMilestoneEvents, toMilestoneTimeline } from "./timeline";
import type { MilestoneUpdateResult, UpdateMilestoneInput } from "./types";

/** Statuses a client should hear about without being assigned. */
const CLIENT_STATUS_ALERTS = new Set([
	"in_review",
	"ready",
	"done",
	"blocked",
	"cancelled",
]);

/** Update any subset of fields. This is the endpoint autosave calls. */
export async function updateMilestone(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	input: UpdateMilestoneInput,
): Promise<MilestoneUpdateResult> {
	const write = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertWritable(tenant, access);

			// A status change is the one patch that also writes a period and a
			// round, so it locks the milestone row to serialize two people
			// changing it at once. Every other field stays lock free, so two
			// tabs editing different fields never wait on each other.
			const record =
				input.status !== undefined
					? await requireMilestoneRecordForUpdate(
							tx,
							tenant,
							projectId,
							milestoneId,
						)
					: await requireMilestoneRecord(tx, tenant, projectId, milestoneId);

			// The lock freezes the document, the title, the dates and the
			// estimate. Status and assignees stay available to staff, because
			// moving work and handing it over is progress rather than a change
			// to the agreed scope.
			const touchesLockedField =
				input.title !== undefined ||
				input.description !== undefined ||
				input.startDate !== undefined ||
				input.dueDate !== undefined ||
				input.estimateMinutes !== undefined;

			if (record.lockedAt !== null && touchesLockedField) {
				throw new APIError("BAD_REQUEST", {
					message: MILESTONE_LOCKED_MESSAGE,
				});
			}

			// Autosave can fire with an empty body, for example when a field
			// was focused and blurred without a change. Writing here would move
			// `updatedAt` and attribute an edit that never happened, so the
			// current detail is returned untouched.
			const hasRecognisedField =
				input.title !== undefined ||
				input.status !== undefined ||
				input.description !== undefined ||
				input.startDate !== undefined ||
				input.dueDate !== undefined ||
				input.estimateMinutes !== undefined ||
				input.assigneeUserIds !== undefined;

			if (!hasRecognisedField) {
				const detail = await loadDetail(
					tx,
					tenant,
					projectId,
					milestoneId,
					access,
				);

				return { detail, changed: [], eventRows: [], notifications: [] };
			}

			const patch: Partial<typeof milestone.$inferInsert> = {
				updatedBy: tenant.userId,
			};
			const events: MilestoneEventDraft[] = [];
			const changed: MilestoneChangedField[] = [];
			let statusChange: { from: string; to: string } | null = null;
			let addedDescriptionMentionIds: string[] = [];
			let addedAssigneeUserIds: string[] = [];

			if (input.title !== undefined) {
				const title = validateMilestoneTitle(input.title);
				patch.title = title;

				if (title !== record.title) changed.push("title");
			}

			if (input.status !== undefined) {
				const status = validateMilestoneStatus(input.status);
				patch.status = status;

				if (status !== record.status) {
					// Blocked is the only transition that must explain itself.
					// Cancelled accepts an optional reason, and both land on the
					// status event and the phase period.
					const note = validateMilestoneNote(
						input.statusNote,
						status === "cancelled"
							? "The cancellation reason"
							: "The blocked reason",
					);

					if (milestoneStatusNeedsNote(status) && !note) {
						throw new APIError("BAD_REQUEST", {
							message: "Say why this milestone is blocked.",
						});
					}

					events.push({
						type: "status",
						from: record.status,
						to: status,
						note,
					});
					statusChange = { from: record.status, to: status };
					changed.push("status");

					// Close the old phase and open the new one at the same
					// instant, so a period never leaves a micro gap between
					// visits. The partial unique index is the backstop, and the
					// row lock above is what keeps two writers from racing.
					const transitionAt = new Date();
					await closeOpenStatusPeriod(tx, tenant, milestoneId, transitionAt);
					const period = await openStatusPeriod(tx, tenant, {
						projectId,
						milestoneId,
						status,
						note,
						enteredAt: transitionAt,
					});

					// Testing and review each own a fresh round for this visit.
					if (status === "in_testing" || status === "in_review") {
						await createPhaseRoundEntry(tx, tenant, {
							projectId,
							milestoneId,
							kind: status === "in_testing" ? "test" : "review",
							statusPeriodId: period.id,
						});
					}
				}

				// `completed_at` is derived state. Keep it in sync here so no
				// code path can produce "done but never completed".
				if (status === "done" && record.status !== "done") {
					patch.completedAt = new Date();
				} else if (status !== "done") {
					patch.completedAt = null;
				}
			}

			if (input.description !== undefined) {
				const description = sanitizeRichText(input.description);
				await assertCommentMentions(tx, tenant, projectId, description.value);

				// The value is a Plate array of plain JSON, so a string compare
				// is a faithful "did the body actually change" check. Listing an
				// unchanged body would tell the client a save happened when it
				// did not.
				const descriptionChanged =
					JSON.stringify(description.value) !==
					JSON.stringify(record.description);

				patch.description = description.value;
				patch.descriptionText = description.text;

				if (descriptionChanged) {
					changed.push("description");
					const beforeMentions = mentionedUserIds(record.description);
					addedDescriptionMentionIds = [
						...mentionedUserIds(description.value),
					].filter((userId) => !beforeMentions.has(userId));
				}
			}

			// The range check needs both sides, so a one sided patch is compared
			// against the value already stored.
			const previousStart = toIsoDay(record.startDate);
			const previousDue = toIsoDay(record.dueDate);
			const nextStart =
				input.startDate !== undefined
					? validateMilestoneDate(input.startDate, "The start date")
					: previousStart;
			const nextDue =
				input.dueDate !== undefined
					? validateMilestoneDate(input.dueDate, "The due date")
					: previousDue;

			if (input.startDate !== undefined) {
				patch.startDate = nextStart;

				if (nextStart !== previousStart) {
					events.push({
						type: "start_date",
						from: previousStart,
						to: nextStart,
					});
					changed.push("startDate");
				}
			}

			if (input.dueDate !== undefined) {
				patch.dueDate = nextDue;

				if (nextDue !== previousDue) {
					events.push({ type: "due_date", from: previousDue, to: nextDue });
					changed.push("dueDate");
				}
			}

			validateMilestoneDateRange(nextStart, nextDue);

			if (input.estimateMinutes !== undefined) {
				const estimate = validateMilestoneEstimate(input.estimateMinutes);
				patch.estimateMinutes = estimate;

				const estimateEvent = buildEstimateEvent(
					record.estimateMinutes,
					estimate,
				);

				if (estimateEvent) {
					events.push(estimateEvent);
					changed.push("estimateMinutes");
				}
			}

			// A PATCH that names fields but changes none of them is also a no-op.
			// Assignees are excluded because their set is replaced even when the
			// derived event list is empty, so that path still has to run.
			if (
				changed.length === 0 &&
				events.length === 0 &&
				input.assigneeUserIds === undefined
			) {
				const detail = await loadDetail(
					tx,
					tenant,
					projectId,
					milestoneId,
					access,
				);

				return { detail, changed: [], eventRows: [], notifications: [] };
			}

			await tx
				.update(milestone)
				.set(patch)
				.where(
					and(
						eq(milestone.organizationId, tenant.organizationId),
						eq(milestone.projectId, projectId),
						eq(milestone.id, milestoneId),
					),
				);

			// Assignees are replaced as a set, so the timeline is derived from
			// the two snapshots rather than from the request. That also catches
			// the case where the same set is sent again: no rows, no change.
			if (input.assigneeUserIds !== undefined) {
				const previous =
					(await loadAssignees(tx, tenant, [milestoneId])).get(milestoneId) ??
					[];
				const memberIds = await resolveAssigneeMemberIds(
					tx,
					tenant,
					projectId,
					input.assigneeUserIds,
				);

				await replaceAssignees(tx, tenant, milestoneId, memberIds);

				const next =
					(await loadAssignees(tx, tenant, [milestoneId])).get(milestoneId) ??
					[];
				const assigneeEvents = buildAssigneeEvents(previous, next);
				const beforeIds = new Set(previous.map((person) => person.userId));

				addedAssigneeUserIds = next
					.filter((person) => !beforeIds.has(person.userId))
					.map((person) => person.userId);

				if (assigneeEvents.length > 0) {
					events.push(...assigneeEvents);
					changed.push("assignees");
				}
			}

			// Recorded last so an assignee change made in the same PATCH is part
			// of the same insert and the same broadcast.
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

			const noticeByUser = new Map<
				string,
				"mention" | "milestone_assigned" | "milestone_status"
			>();

			for (const userId of addedDescriptionMentionIds) {
				noticeByUser.set(userId, "mention");
			}

			for (const userId of addedAssigneeUserIds) {
				if (!noticeByUser.has(userId)) {
					noticeByUser.set(userId, "milestone_assigned");
				}
			}

			if (statusChange) {
				const recipients = await loadMilestoneAssigneeUserIds(
					tx,
					tenant,
					milestoneId,
				);

				if (CLIENT_STATUS_ALERTS.has(statusChange.to)) {
					recipients.push(
						...(await loadProjectMemberUserIds(tx, tenant, projectId, [
							"client",
						])),
					);
				}

				for (const userId of new Set(recipients)) {
					if (!noticeByUser.has(userId)) {
						noticeByUser.set(userId, "milestone_status");
					}
				}
			}

			const projectView = {
				id: access.row.id,
				name: access.row.name,
				slug: access.row.slug,
			};
			const milestoneView = {
				id: milestoneId,
				title: detail.milestone.title,
			};
			const statusRowId =
				eventRows.find((row) => row.eventType === "status")?.id ?? null;
			const assigneeRowId =
				eventRows.find((row) => row.eventType === "assignee_added")?.id ?? null;

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
									? `mention:milestone:${milestoneId}:${recipientUserId}:${detail.milestone.updatedAt}`
									: type === "milestone_assigned"
										? `assign:${assigneeRowId ?? milestoneId}:${recipientUserId}`
										: `status:${statusRowId ?? milestoneId}:${recipientUserId}`,
							project: projectView,
							milestone: milestoneView,
							data:
								type === "milestone_status" && statusChange
									? { status: statusChange.to }
									: {},
						}),
					),
			);

			return { detail, changed, eventRows, notifications };
		},
	);

	// The activity rows are mapped after the commit, so the extra user lookup
	// never extends the transaction.
	const timeline = await toMilestoneTimeline(write.eventRows, tenant);

	// Only a body change can introduce a new link. Every other patch skips the
	// queue entirely, which keeps status and date edits free.
	if (input.description !== undefined) {
		void queueDocumentPreviews(
			tenant,
			write.detail.milestone.description,
		).catch(() => undefined);
	}

	return {
		...write.detail,
		changed: write.changed,
		timeline,
		notifications: write.notifications,
	};
}
