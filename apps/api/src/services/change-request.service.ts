/**
 * Change request business logic.
 *
 * Why a service: a change request has rules that the route must not own. Who
 * may raise one, who may decide it, whether the milestone is locked, and what
 * the decision does to the timeline must be identical everywhere. They live
 * here.
 *
 * Shape follows `milestone.service.ts`:
 *   - every query runs through `withTenant`, so RLS confines it to one workspace
 *   - milestone and project visibility is delegated to `requireMilestoneAccess`
 *   - Better Auth tables are read through `loadUserMap`, never joined inside a
 *     tenant query
 *
 * The lock rule is deliberately inverted here: a change request is not part of
 * the locked milestone, so creating, editing, declining, withdrawing or moving
 * one works while the milestone is locked. Accepting a request is the one
 * decision that implies a scope edit, so it asks for an unlock first.
 *
 * Used by: src/routes/change-requests.ts.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
	type ChangeRequestStatus,
	canCreateChangeRequest,
	canDecideChangeRequest,
	canEditChangeRequest,
	canWithdrawChangeRequest,
	isChangeRequestStatus,
	validateChangeRequestTitle,
} from "../auth/change-request-permissions";
import {
	MILESTONE_LOCKED_MESSAGE,
	validateMilestoneNote,
} from "../auth/milestone-permissions";
import { assertProjectActive } from "../auth/project-permissions";
import { changeRequest, milestone } from "../db/schema";
import { type TenantTx, withTenant } from "../db/tenant";
import type { MilestoneEventDraft } from "../lib/milestone-events";
import { sanitizeOptionalCommentBody } from "../lib/rich-text";
import type { TenantContext } from "../middleware/tenant";
import { queueDocumentPreviews } from "./link-preview.service";
import { assertCommentMentions } from "./mention.service";
import {
	insertMilestone,
	type MilestoneDetail,
	type MilestoneTimelineComment,
	recordMilestoneEvents,
	requireMilestoneAccess,
	toMilestoneTimeline,
} from "./milestone.service";
import { loadUserMap } from "./project.service";

/** A database row, before it is mapped to the wire shape. */
export type ChangeRequestRecord = typeof changeRequest.$inferSelect;

/** One person attached to a request. */
export type ChangeRequestPerson = {
	id: string;
	name: string;
	image: string | null;
};

/** One change request as the Changes tab renders it. */
export type ChangeRequestRow = {
	id: string;
	projectId: string;
	milestoneId: string;
	title: string;
	body: unknown[];
	bodyText: string;
	status: ChangeRequestStatus;
	requestedBy: ChangeRequestPerson | null;
	decidedBy: ChangeRequestPerson | null;
	decidedAt: string | null;
	decisionNote: string | null;
	targetMilestoneId: string | null;
	targetMilestoneTitle: string | null;
	createdAt: string;
	updatedAt: string;
	/** True when this caller may still change the title or the body. */
	canEdit: boolean;
	/** True when this caller may pull the request back. */
	canWithdraw: boolean;
};

/** Everything the Changes tab needs in one request. */
export type ChangeRequestListResult = {
	projectId: string;
	milestoneId: string;
	changeRequests: ChangeRequestRow[];
	counts: Record<ChangeRequestStatus, number>;
	openCount: number;
	/** True when the caller may accept, decline or move a request. */
	canDecide: boolean;
};

/** The result every write returns, plus the activity rows to broadcast. */
export type ChangeRequestWriteResult = {
	changeRequest: ChangeRequestRow;
	openCount: number;
	timeline: MilestoneTimelineComment[];
};

/** Moving a request also returns the milestone that was created. */
export type ChangeRequestMoveResult = ChangeRequestWriteResult & {
	milestone: MilestoneDetail;
};

/** Public create input. */
export type CreateChangeRequestInput = {
	title: string;
	body?: unknown;
};

/** Public patch input. A patch either edits the text or records a decision. */
export type UpdateChangeRequestInput = {
	title?: string;
	body?: unknown;
	status?: string;
	note?: string | null;
};

/** Public move input. The dialog may override the prefilled title and body. */
export type MoveChangeRequestInput = {
	title?: string;
	description?: unknown;
	status?: string;
	statusNote?: string | null;
	startDate?: string | null;
	dueDate?: string | null;
	estimateMinutes?: number | null;
	assigneeUserIds?: string[];
};

/** Every status initialized to zero, so the UI never has to guess. */
function emptyCounts(): Record<ChangeRequestStatus, number> {
	return {
		open: 0,
		accepted: 0,
		declined: 0,
		moved: 0,
		withdrawn: 0,
	};
}

/** The scope every single request read or write uses. */
function changeRequestScope(
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
async function requireChangeRequestRecord(
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

/** Map one row into the wire shape. */
function toChangeRequestRow(
	record: ChangeRequestRecord,
	people: Map<string, { name: string; email: string; image: string | null }>,
	targetTitles: Map<string, string>,
	viewerId: string,
): ChangeRequestRow {
	const status = record.status as ChangeRequestStatus;

	const person = (id: string | null): ChangeRequestPerson | null => {
		if (!id) return null;

		const profile = people.get(id);

		return {
			id,
			name: profile?.name || profile?.email || "Former member",
			image: profile?.image ?? null,
		};
	};

	return {
		id: record.id,
		projectId: record.projectId,
		milestoneId: record.milestoneId,
		title: record.title,
		body: record.body,
		bodyText: record.bodyText,
		status,
		requestedBy: person(record.requestedBy),
		decidedBy: person(record.decidedBy),
		decidedAt: record.decidedAt ? record.decidedAt.toISOString() : null,
		decisionNote: record.decisionNote,
		targetMilestoneId: record.targetMilestoneId,
		targetMilestoneTitle: record.targetMilestoneId
			? (targetTitles.get(record.targetMilestoneId) ?? null)
			: null,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
		canEdit: canEditChangeRequest({
			viewerId,
			requestedBy: record.requestedBy,
			status,
		}),
		canWithdraw: canWithdrawChangeRequest({
			viewerId,
			requestedBy: record.requestedBy,
			status,
		}),
	};
}

/** Resolve the titles of the milestones a page of requests points at. */
async function loadTargetTitles(
	tx: TenantTx,
	tenant: TenantContext,
	records: ChangeRequestRecord[],
): Promise<Map<string, string>> {
	const ids = [
		...new Set(
			records
				.map((record) => record.targetMilestoneId)
				.filter((id): id is string => Boolean(id)),
		),
	];

	if (ids.length === 0) return new Map();

	const rows = await tx
		.select({ id: milestone.id, title: milestone.title })
		.from(milestone)
		.where(
			and(
				eq(milestone.organizationId, tenant.organizationId),
				inArray(milestone.id, ids),
			),
		);

	return new Map(rows.map((row) => [row.id, row.title]));
}

/** Load the names for every person attached to a set of requests. */
async function loadPeople(
	records: ChangeRequestRecord[],
): Promise<Map<string, { name: string; email: string; image: string | null }>> {
	const ids = [
		...new Set(
			records
				.flatMap((record) => [record.requestedBy, record.decidedBy])
				.filter((id): id is string => Boolean(id)),
		),
	];

	return loadUserMap(ids);
}

/** Count the requests of one milestone by status. */
async function loadCounts(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
): Promise<Record<ChangeRequestStatus, number>> {
	const rows = await tx
		.select({
			status: changeRequest.status,
			count: sql<number>`count(*)`.mapWith(Number),
		})
		.from(changeRequest)
		.where(
			and(
				eq(changeRequest.organizationId, tenant.organizationId),
				eq(changeRequest.milestoneId, milestoneId),
			),
		)
		.groupBy(changeRequest.status);

	const counts = emptyCounts();

	for (const row of rows) {
		if (isChangeRequestStatus(row.status)) {
			counts[row.status] = row.count;
		}
	}

	return counts;
}

/** Build the wire row plus the current open count in one transaction. */
async function toWriteShape(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	record: ChangeRequestRecord,
): Promise<{ changeRequest: ChangeRequestRow; openCount: number }> {
	const [people, targetTitles, counts] = await Promise.all([
		loadPeople([record]),
		loadTargetTitles(tx, tenant, [record]),
		loadCounts(tx, tenant, milestoneId),
	]);

	return {
		changeRequest: toChangeRequestRow(
			record,
			people,
			targetTitles,
			tenant.userId,
		),
		openCount: counts.open,
	};
}

/** Build one activity row for a change request action. */
function buildEvent(
	type: MilestoneEventDraft["type"],
	title: string,
	note?: string | null,
): MilestoneEventDraft {
	return { type, from: null, to: title, note: note ?? null };
}

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

			const [people, targetTitles, counts] = await Promise.all([
				loadPeople(records),
				loadTargetTitles(tx, tenant, records),
				loadCounts(tx, tenant, milestoneId),
			]);

			return {
				projectId,
				milestoneId,
				changeRequests: records.map((record) =>
					toChangeRequestRow(record, people, targetTitles, tenant.userId),
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
			const { access } = await requireMilestoneAccess(
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

			return {
				...(await toWriteShape(tx, tenant, milestoneId, record)),
				eventRows,
			};
		},
	);

	const timeline = await toMilestoneTimeline(write.eventRows, tenant);

	return {
		changeRequest: write.changeRequest,
		openCount: write.openCount,
		timeline,
	};
}

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
			const { access, milestone: milestoneRecord } =
				await requireMilestoneAccess(tx, tenant, projectId, milestoneId);

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

					// Accepting implies the scope will change, so it is the one
					// decision the lock asks you to clear first. Declining and
					// withdrawing change nothing in the milestone.
					if (next === "accepted" && milestoneRecord.lockedAt !== null) {
						throw new APIError("BAD_REQUEST", {
							message: MILESTONE_LOCKED_MESSAGE,
						});
					}

					await tx
						.update(changeRequest)
						.set({
							status: next,
							decidedBy: tenant.userId,
							decidedAt: new Date(),
							decisionNote: note,
						})
						.where(changeRequestScope(tenant, milestoneId, changeRequestId));

					event = buildEvent(
						next === "accepted"
							? "change_request_accepted"
							: "change_request_declined",
						record.title,
						note,
					);
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

			return {
				...(await toWriteShape(tx, tenant, milestoneId, updated)),
				eventRows,
			};
		},
	);

	const timeline = await toMilestoneTimeline(write.eventRows, tenant);

	return {
		changeRequest: write.changeRequest,
		openCount: write.openCount,
		timeline,
	};
}

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

			return {
				...(await toWriteShape(tx, tenant, milestoneId, updated)),
				eventRows,
				created,
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
		timeline,
	};
}
