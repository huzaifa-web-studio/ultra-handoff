/**
 * Change request decisions and edits.
 *
 * Why this file: editing and deciding share the status transition rules, the
 * timeline event and the notification fan out. Keeping them together means a
 * decision cannot be recorded differently on the two paths.
 *
 * Used by: `routes/change-requests.ts`.
 */

import { APIError } from "better-auth/api";
import {
	type ChangeRequestStatus,
	canDecideChangeRequest,
	canEditChangeRequest,
	canWithdrawChangeRequest,
	isChangeRequestStatus,
	validateChangeRequestTitle,
} from "../../auth/change-request-permissions";
import { validateMilestoneNote } from "../../auth/milestone-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { changeRequest } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { MilestoneEventDraft } from "../../lib/milestone-events";
import { sanitizeOptionalCommentBody } from "../../lib/rich-text";
import type { TenantContext } from "../../middleware/tenant";
import { queueDocumentPreviews } from "../link-preview.service";
import { assertCommentMentions } from "../mention.service";
import {
	recordMilestoneEvents,
	requireMilestoneAccess,
	toMilestoneTimeline,
} from "../milestone";
import {
	createChangeScopeEntry,
	type MilestoneScopeEntrySummary,
} from "../milestone/scope";
import {
	createNotifications,
	loadMilestoneAssigneeUserIds,
	loadProjectManagerUserIds,
	type NotificationCandidate,
} from "../notification.service";
import { loadUserMap } from "../project";
import { changeRequestScope, requireChangeRequestRecord } from "./access";
import { buildEvent } from "./events";
import { mentionedUserIds } from "./mentions";
import { toWriteShape } from "./payload";
import type {
	ChangeRequestWriteResult,
	UpdateChangeRequestInput,
} from "./types";

/**
 * Edit the text of an open request, or record a decision.
 *
 * Why one endpoint for both: the UI has one record and two kinds of change, and
 * keeping them together means one permission check path. They are never sent in
 * the same request, because "change the words and accept it" would leave the
 * reader unsure what was accepted.
 */
export async function updateChangeRequest(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	changeRequestId: string,
	input: UpdateChangeRequestInput,
): Promise<ChangeRequestWriteResult> {
	const editsContent = input.title !== undefined || input.body !== undefined;
	const decides = input.status !== undefined;

	if (editsContent && decides) {
		throw new APIError("BAD_REQUEST", {
			message: "Save the text change first, then record the decision.",
		});
	}

	const title =
		input.title !== undefined ? validateChangeRequestTitle(input.title) : null;
	const body =
		input.body !== undefined ? sanitizeOptionalCommentBody(input.body) : null;

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

			const record = await requireChangeRequestRecord(
				tx,
				tenant,
				milestoneId,
				changeRequestId,
				{ forUpdate: true },
			);
			const status = record.status as ChangeRequestStatus;
			let event: MilestoneEventDraft | null = null;
			let acceptedScopeEntry: MilestoneScopeEntrySummary | null = null;
			let acceptedScopeBody: unknown[] | null = null;
			let addedMentionIds: string[] = [];
			let decisionStatus: string | null = null;

			if (editsContent) {
				if (
					!canEditChangeRequest({
						viewerId: tenant.userId,
						requestedBy: record.requestedBy,
						status,
					})
				) {
					throw new APIError("FORBIDDEN", {
						message:
							"Only the person who wrote this request can edit it while it is open.",
					});
				}

				if (body) {
					await assertCommentMentions(tx, tenant, projectId, body.value);

					const beforeMentions = mentionedUserIds(record.body);
					addedMentionIds = [...mentionedUserIds(body.value)].filter(
						(userId) => !beforeMentions.has(userId),
					);
				}

				await tx
					.update(changeRequest)
					.set({
						...(title !== null ? { title } : {}),
						...(body ? { body: body.value, bodyText: body.text } : {}),
					})
					.where(changeRequestScope(tenant, milestoneId, changeRequestId));
			} else if (decides) {
				const next = input.status ?? "";

				if (!isChangeRequestStatus(next)) {
					throw new APIError("BAD_REQUEST", {
						message: `Unknown change request status: ${input.status}.`,
					});
				}

				if (status !== "open") {
					throw new APIError("BAD_REQUEST", {
						message: "This change request has already been decided.",
					});
				}

				if (next === "open") {
					throw new APIError("BAD_REQUEST", {
						message: "This change request is already open.",
					});
				}

				if (next === "moved") {
					throw new APIError("BAD_REQUEST", {
						message:
							"Use the move action so a new milestone is created and linked.",
					});
				}

				if (next === "withdrawn") {
					if (
						!canWithdrawChangeRequest({
							viewerId: tenant.userId,
							requestedBy: record.requestedBy,
							status,
						})
					) {
						throw new APIError("FORBIDDEN", {
							message:
								"Only the person who wrote this request can withdraw it.",
						});
					}

					await tx
						.update(changeRequest)
						.set({ status: "withdrawn", decisionNote: null })
						.where(changeRequestScope(tenant, milestoneId, changeRequestId));

					event = buildEvent("change_request_withdrawn", record.title);
					decisionStatus = "withdrawn";
				} else {
					if (!canDecideChangeRequest(tenant.role, access.role)) {
						throw new APIError("FORBIDDEN", {
							message: "Only staff can accept or decline a change request.",
						});
					}

					const note = validateMilestoneNote(input.note, "The decision note");

					if (next === "declined" && !note) {
						throw new APIError("BAD_REQUEST", {
							message: "Say why this change request is declined.",
						});
					}

					// The accepted section text belongs to acceptance only.
					if (
						next !== "accepted" &&
						(input.scopeTitle !== undefined || input.scopeBody !== undefined)
					) {
						throw new APIError("BAD_REQUEST", {
							message: "Scope text can only be sent when accepting a request.",
						});
					}

					// Accepting no longer needs an unlock. It appends a named
					// section and never rewrites the locked initial scope, so the
					// lock still protects exactly what it was meant to protect.
					await tx
						.update(changeRequest)
						.set({
							status: next,
							decidedBy: tenant.userId,
							decidedAt: new Date(),
							decisionNote: note,
						})
						.where(changeRequestScope(tenant, milestoneId, changeRequestId));

					if (next === "accepted") {
						const bodyIsStored =
							input.scopeBody === undefined ||
							JSON.stringify(input.scopeBody) === JSON.stringify(record.body);
						const entry = await createChangeScopeEntry(
							tx,
							tenant,
							{
								projectId,
								milestoneId,
								changeRequestId,
								title: input.scopeTitle ?? record.title,
								body: bodyIsStored
									? record.body
									: ((input.scopeBody as unknown[]) ?? []),
								bodyText: record.bodyText,
							},
							{ trustedBody: bodyIsStored },
						);

						const names = await loadUserMap([tenant.userId]);
						const person = names.get(tenant.userId);
						acceptedScopeBody = entry.body;
						acceptedScopeEntry = {
							id: entry.id,
							kind: "change",
							round: null,
							title: entry.title,
							hasBody: entry.body.length > 0,
							changeRequestId: entry.changeRequestId,
							statusPeriodId: entry.statusPeriodId,
							createdBy: entry.createdBy,
							createdByName: person?.name || person?.email || "Someone",
							updatedBy: entry.updatedBy,
							updatedByName: person?.name || person?.email || "Someone",
							createdAt: entry.createdAt.toISOString(),
							updatedAt: entry.updatedAt.toISOString(),
						};
					}

					event = buildEvent(
						next === "accepted"
							? "change_request_accepted"
							: "change_request_declined",
						record.title,
						note,
					);
					decisionStatus = next;
				}
			}

			const updated = await requireChangeRequestRecord(
				tx,
				tenant,
				milestoneId,
				changeRequestId,
			);

			const eventRows = event
				? await recordMilestoneEvents(tx, tenant, milestoneId, [event])
				: [];

			const noticeByUser = new Map<
				string,
				"mention" | "change_request_decided" | "change_request_withdrawn"
			>();

			for (const userId of addedMentionIds) {
				noticeByUser.set(userId, "mention");
			}

			if (decisionStatus === "withdrawn") {
				const recipients = new Set([
					...(await loadProjectManagerUserIds(tx, tenant, projectId)),
					...(await loadMilestoneAssigneeUserIds(tx, tenant, milestoneId)),
				]);

				for (const userId of recipients) {
					if (!noticeByUser.has(userId)) {
						noticeByUser.set(userId, "change_request_withdrawn");
					}
				}
			} else if (decisionStatus && record.requestedBy) {
				if (!noticeByUser.has(record.requestedBy)) {
					noticeByUser.set(record.requestedBy, "change_request_decided");
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
									? `mention:change:${changeRequestId}:${recipientUserId}:${updated.updatedAt.toISOString()}`
									: type === "change_request_decided"
										? `cr_decided:${changeRequestId}:${decisionStatus}:${recipientUserId}`
										: `cr_withdrawn:${changeRequestId}:${recipientUserId}`,
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
								id: updated.id,
								title: updated.title,
							},
							data:
								type === "change_request_decided" && decisionStatus
									? { decision: decisionStatus }
									: {},
						}),
					),
			);

			return {
				...(await toWriteShape(tx, tenant, milestoneId, updated)),
				scopeEntry: acceptedScopeEntry,
				acceptedScopeBody,
				eventRows,
				notifications,
			};
		},
	);

	// Enrichment only: a trimmed accepted body can introduce a new link, and a
	// queue failure must never turn an accepted decision into an error.
	if (write.acceptedScopeBody) {
		void queueDocumentPreviews(tenant, write.acceptedScopeBody).catch(
			() => undefined,
		);
	}

	const timeline = await toMilestoneTimeline(write.eventRows, tenant);

	return {
		changeRequest: write.changeRequest,
		openCount: write.openCount,
		scopeEntry: write.scopeEntry,
		timeline,
		notifications: write.notifications,
	};
}
