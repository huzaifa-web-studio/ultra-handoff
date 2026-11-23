/**
 * Milestone scope sections.
 *
 * The initial scope lives on `milestone.description` and is unchanged by this
 * service. This module owns the named additions underneath it:
 *
 *   - `change` sections created when a change request is accepted
 *   - `test` rounds created when a milestone enters testing
 *   - `review` rounds created when a milestone enters review
 *
 * Why the phase rule lives here: "test notes can only be written in testing"
 * is a data rule, not a UI hint. It is enforced by matching the section to the
 * exact open status period, so an old round cannot become writable again just
 * because the status name came back.
 *
 * Reads return metadata only. Rich text bodies are fetched one at a time, so a
 * long lived milestone cannot make the detail response grow with every round.
 *
 * Used by: services/milestone.service.ts, services/change-request.service.ts
 * and routes/milestones.ts.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, asc, eq, max, sql } from "drizzle-orm";

import {
	canEditChangeScopeEntry,
	canWriteReviewScope,
	canWriteTestScope,
	MILESTONE_LOCKED_MESSAGE,
	validateMilestoneScopeTitle,
} from "../auth/milestone-permissions";
import { assertProjectActive } from "../auth/project-permissions";
import { milestone, milestoneScopeEntry } from "../db/schema";
import { type TenantTx, withTenant } from "../db/tenant";
import { collectMentionKeys } from "../lib/mentions";
import { sanitizeRichText } from "../lib/rich-text";
import type { TenantContext } from "../middleware/tenant";
import { queueDocumentPreviews } from "./link-preview.service";
import { assertCommentMentions } from "./mention.service";
import { loadOpenPeriodId } from "./milestone-phase.service";
import {
	createNotifications,
	type NotificationDelivery,
} from "./notification.service";
import { loadProjectAccess, loadUserMap } from "./project.service";

/** The three kinds of scope addition. */
export type MilestoneScopeKind = "change" | "test" | "review";

/** The fields every summary needs, without the rich text body. */
type ScopeEntrySource = {
	id: string;
	kind: string;
	round: number | null;
	title: string;
	changeRequestId: string | null;
	statusPeriodId: string | null;
	createdBy: string | null;
	updatedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
};

/** One section without its rich text body. */
export type MilestoneScopeEntrySummary = {
	id: string;
	kind: MilestoneScopeKind;
	/** Test and review only. Null for an accepted change. */
	round: number | null;
	title: string;
	/** True when the body is more than an empty document. */
	hasBody: boolean;
	changeRequestId: string | null;
	statusPeriodId: string | null;
	createdBy: string | null;
	createdByName: string | null;
	updatedBy: string | null;
	updatedByName: string | null;
	createdAt: string;
	updatedAt: string;
};

/** One section with its full editor document. */
export type MilestoneScopeEntry = MilestoneScopeEntrySummary & {
	body: unknown[];
};

/** A database row, before it is mapped to the wire shape. */
export type MilestoneScopeEntryRecord = typeof milestoneScopeEntry.$inferSelect;

/** One scope update plus the notifications it produced. */
export type MilestoneScopeUpdateResult = MilestoneScopeEntry & {
	notifications: NotificationDelivery[];
};

/** Public update input for one section. */
export type UpdateMilestoneScopeEntryInput = {
	title?: string;
	body?: unknown;
};

/** Map a record plus a name lookup into the summary shape. */
function toSummary(
	record: ScopeEntrySource,
	names: Map<string, string>,
	hasBody: boolean,
): MilestoneScopeEntrySummary {
	return {
		id: record.id,
		kind: record.kind as MilestoneScopeKind,
		round: record.round,
		title: record.title,
		hasBody,
		changeRequestId: record.changeRequestId,
		statusPeriodId: record.statusPeriodId,
		createdBy: record.createdBy,
		createdByName: record.createdBy
			? (names.get(record.createdBy) ?? null)
			: null,
		updatedBy: record.updatedBy,
		updatedByName: record.updatedBy
			? (names.get(record.updatedBy) ?? null)
			: null,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

/** Resolve the display names for a set of records in one lookup. */
async function loadNames(
	records: { createdBy: string | null; updatedBy: string | null }[],
): Promise<Map<string, string>> {
	const ids = [
		...new Set(
			records
				.flatMap((record) => [record.createdBy, record.updatedBy])
				.filter((id): id is string => Boolean(id)),
		),
	];

	if (ids.length === 0) return new Map();

	const people = await loadUserMap(ids);
	const names = new Map<string, string>();

	for (const [id, person] of people) {
		names.set(id, person.name || person.email || "Someone");
	}

	return names;
}

/** One section inside a milestone, or null. */
async function findEntryRecord(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
	entryId: string,
): Promise<MilestoneScopeEntryRecord | null> {
	const [row] = await tx
		.select()
		.from(milestoneScopeEntry)
		.where(
			and(
				eq(milestoneScopeEntry.organizationId, tenant.organizationId),
				eq(milestoneScopeEntry.milestoneId, milestoneId),
				eq(milestoneScopeEntry.id, entryId),
			),
		)
		.limit(1);

	return row ?? null;
}

/**
 * Insert one section inside an existing transaction.
 *
 * The scope rules do not run here: callers have already decided that this write
 * is allowed.
 */
async function insertScopeEntry(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		kind: MilestoneScopeKind;
		round: number | null;
		title: string;
		body: unknown[];
		bodyText: string;
		changeRequestId?: string | null;
		statusPeriodId?: string | null;
	},
): Promise<MilestoneScopeEntryRecord> {
	const [row] = await tx
		.insert(milestoneScopeEntry)
		.values({
			id: randomUUID(),
			organizationId: tenant.organizationId,
			projectId: input.projectId,
			milestoneId: input.milestoneId,
			kind: input.kind,
			round: input.round,
			title: input.title,
			body: input.body,
			bodyText: input.bodyText,
			changeRequestId: input.changeRequestId ?? null,
			statusPeriodId: input.statusPeriodId ?? null,
			createdBy: tenant.userId,
			updatedBy: tenant.userId,
		})
		.returning();

	if (!row) {
		throw new Error("Could not create the scope section.");
	}

	return row;
}

/** The wire shape of a freshly inserted or updated section, with its body. */
async function toEntry(
	record: MilestoneScopeEntryRecord,
): Promise<MilestoneScopeEntry> {
	const names = await loadNames([record]);

	return {
		...toSummary(record, names, record.body.length > 0),
		body: record.body,
	};
}

/**
 * Create the section for an accepted change request.
 *
 * `title` and `body` are the final accepted text, which the accept dialog may
 * have trimmed. When the body is the stored request text, `trustedBody` skips
 * sanitizing and mention checks so a former member cannot block the decision.
 */
export async function createChangeScopeEntry(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		changeRequestId: string;
		title: string;
		body: unknown;
		bodyText?: string;
	},
	options: { trustedBody?: boolean } = {},
): Promise<MilestoneScopeEntryRecord> {
	const title = validateMilestoneScopeTitle(input.title);
	const description = options.trustedBody
		? { value: input.body as unknown[], text: input.bodyText ?? "" }
		: sanitizeRichText(input.body);

	if (!options.trustedBody) {
		await assertCommentMentions(tx, tenant, input.projectId, description.value);
	}

	return insertScopeEntry(tx, tenant, {
		projectId: input.projectId,
		milestoneId: input.milestoneId,
		kind: "change",
		round: null,
		title,
		body: description.value,
		bodyText: description.text,
		changeRequestId: input.changeRequestId,
		statusPeriodId: null,
	});
}

/**
 * Create the round that belongs to a phase visit.
 *
 * Called in the same transaction as the status change, after the new period is
 * open, so the round and the timing record cannot disagree. The row lock on the
 * milestone is what makes the round number safe.
 */
export async function createPhaseRoundEntry(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		projectId: string;
		milestoneId: string;
		kind: "test" | "review";
		statusPeriodId: string;
	},
): Promise<MilestoneScopeEntryRecord> {
	const [row] = await tx
		.select({ highest: max(milestoneScopeEntry.round) })
		.from(milestoneScopeEntry)
		.where(
			and(
				eq(milestoneScopeEntry.organizationId, tenant.organizationId),
				eq(milestoneScopeEntry.milestoneId, input.milestoneId),
				eq(milestoneScopeEntry.kind, input.kind),
			),
		);

	const round = Number(row?.highest ?? 0) + 1;
	const title =
		input.kind === "test" ? `Test round ${round}` : `Review round ${round}`;

	return insertScopeEntry(tx, tenant, {
		projectId: input.projectId,
		milestoneId: input.milestoneId,
		kind: input.kind,
		round,
		title,
		body: [],
		bodyText: "",
		statusPeriodId: input.statusPeriodId,
	});
}

/** Every section of one milestone, oldest first, without bodies. */
export async function loadScopeEntries(
	tx: TenantTx,
	tenant: TenantContext,
	milestoneId: string,
): Promise<MilestoneScopeEntrySummary[]> {
	const rows = await tx
		.select({
			id: milestoneScopeEntry.id,
			kind: milestoneScopeEntry.kind,
			round: milestoneScopeEntry.round,
			title: milestoneScopeEntry.title,
			changeRequestId: milestoneScopeEntry.changeRequestId,
			statusPeriodId: milestoneScopeEntry.statusPeriodId,
			createdBy: milestoneScopeEntry.createdBy,
			updatedBy: milestoneScopeEntry.updatedBy,
			createdAt: milestoneScopeEntry.createdAt,
			updatedAt: milestoneScopeEntry.updatedAt,
			hasBody:
				sql<boolean>`jsonb_array_length(${milestoneScopeEntry.body}) > 0`.as(
					"scope_has_body",
				),
		})
		.from(milestoneScopeEntry)
		.where(
			and(
				eq(milestoneScopeEntry.organizationId, tenant.organizationId),
				eq(milestoneScopeEntry.milestoneId, milestoneId),
			),
		)
		.orderBy(asc(milestoneScopeEntry.createdAt), asc(milestoneScopeEntry.id));

	const names = await loadNames(rows);

	return rows.map((row) => toSummary(row, names, row.hasBody));
}

/** One section including its full editor document. */
export async function getMilestoneScopeEntry(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	entryId: string,
): Promise<MilestoneScopeEntry> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await requireProjectAccess(tx, tenant, projectId);
			const record = await requireMilestoneRecord(
				tx,
				tenant,
				projectId,
				milestoneId,
			);
			const entry = await findEntryRecord(tx, tenant, record.id, entryId);

			if (!entry) {
				throw new APIError("NOT_FOUND", {
					message: "That scope section no longer exists.",
				});
			}

			return toEntry(entry);
		},
	);
}

/**
 * Save one scope section.
 *
 * The permission and phase checks are the point of this function. A change
 * section follows the normal milestone write rule and stops while locked. A
 * test round is staff only and only in testing. A review round is open to every
 * project member and only in review. Both rounds must belong to the currently
 * open period.
 */
export async function updateMilestoneScopeEntry(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	entryId: string,
	input: UpdateMilestoneScopeEntryInput,
): Promise<MilestoneScopeUpdateResult> {
	const write = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProjectAccess(tx, tenant, projectId);
			assertProjectActive(access.row.archivedAt);

			const record = await requireMilestoneRecord(
				tx,
				tenant,
				projectId,
				milestoneId,
			);
			const entry = await findEntryRecord(tx, tenant, record.id, entryId);

			if (!entry) {
				throw new APIError("NOT_FOUND", {
					message: "That scope section no longer exists.",
				});
			}

			const kind = entry.kind as MilestoneScopeKind;

			if (kind === "change") {
				if (!canEditChangeScopeEntry(tenant.role, access.role)) {
					throw new APIError("FORBIDDEN", {
						message: "You can review scope changes but not edit them.",
					});
				}

				if (record.lockedAt !== null) {
					throw new APIError("BAD_REQUEST", {
						message: MILESTONE_LOCKED_MESSAGE,
					});
				}
			} else if (kind === "test") {
				if (!canWriteTestScope(tenant.role, access.role, record.status)) {
					throw new APIError("FORBIDDEN", {
						message:
							"Testing notes can only be written by staff while the milestone is in testing.",
					});
				}
			} else if (
				!canWriteReviewScope(tenant.role, access.role, record.status)
			) {
				throw new APIError("FORBIDDEN", {
					message:
						"Review notes can only be written while the milestone is in review.",
				});
			}

			// A phase round is editable only during the visit that created it.
			// Matching the status name alone would let round 1 come back to life
			// when the milestone re-enters testing later.
			if (kind === "test" || kind === "review") {
				const openPeriodId = await loadOpenPeriodId(tx, tenant, record.id);

				if (
					!openPeriodId ||
					entry.statusPeriodId === null ||
					entry.statusPeriodId !== openPeriodId
				) {
					throw new APIError("BAD_REQUEST", {
						message:
							"That phase has ended. Reload the milestone to see the current round.",
					});
				}
			}

			if (input.title === undefined && input.body === undefined) {
				return {
					entry: await toEntry(entry),
					bodyChanged: false,
					notifications: [] as NotificationDelivery[],
				};
			}

			const patch: Partial<typeof milestoneScopeEntry.$inferInsert> = {
				updatedBy: tenant.userId,
			};
			let bodyChanged = false;
			let nextBody: unknown[] = entry.body;
			let addedMentionIds: string[] = [];

			if (input.title !== undefined) {
				patch.title = validateMilestoneScopeTitle(input.title);
			}

			if (input.body !== undefined) {
				const description = sanitizeRichText(input.body);

				await assertCommentMentions(tx, tenant, projectId, description.value);

				bodyChanged =
					JSON.stringify(description.value) !== JSON.stringify(entry.body);
				nextBody = description.value;
				patch.body = description.value;
				patch.bodyText = description.text;

				if (bodyChanged) {
					const beforeMentions = new Set(
						collectMentionKeys(entry.body)
							.filter((mention) => mention.type === "user")
							.map((mention) => mention.id),
					);

					addedMentionIds = collectMentionKeys(description.value)
						.filter((mention) => mention.type === "user")
						.map((mention) => mention.id)
						.filter((userId) => !beforeMentions.has(userId));
				}
			}

			const [updated] = await tx
				.update(milestoneScopeEntry)
				.set(patch)
				.where(
					and(
						eq(milestoneScopeEntry.organizationId, tenant.organizationId),
						eq(milestoneScopeEntry.milestoneId, record.id),
						eq(milestoneScopeEntry.id, entryId),
					),
				)
				.returning();

			if (!updated) {
				throw new APIError("NOT_FOUND", {
					message: "That scope section no longer exists.",
				});
			}

			const mapped = await toEntry(updated);
			const notifications = await createNotifications(
				tx,
				tenant,
				addedMentionIds
					.filter((userId) => userId !== tenant.userId)
					.map((recipientUserId) => ({
						recipientUserId,
						actorUserId: tenant.userId,
						type: "mention" as const,
						dedupeKey: `mention:scope:${entryId}:${recipientUserId}:${updated.updatedAt.toISOString()}`,
						project: {
							id: access.row.id,
							name: access.row.name,
							slug: access.row.slug,
						},
						milestone: {
							id: record.id,
							title: record.title,
						},
						scopeEntry: {
							id: entryId,
							title: mapped.title,
						},
					})),
			);

			return {
				entry: mapped,
				bodyChanged,
				nextBody,
				notifications,
			};
		},
	);

	// A new body can introduce links. The queue is enrichment only, so it runs
	// after the commit and never fails the save.
	if (write.bodyChanged && "nextBody" in write) {
		void queueDocumentPreviews(tenant, write.nextBody).catch(() => undefined);
	}

	return { ...write.entry, notifications: write.notifications };
}

/** Load project access or fail with 404, matching every milestone surface. */
async function requireProjectAccess(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
) {
	const access = await loadProjectAccess(tx, tenant, projectId);

	if (!access) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}

	return access;
}

/** Reject a milestone id that does not belong to the project. */
async function requireMilestoneRecord(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
) {
	const [record] = await tx
		.select()
		.from(milestone)
		.where(
			and(
				eq(milestone.organizationId, tenant.organizationId),
				eq(milestone.projectId, projectId),
				eq(milestone.id, milestoneId),
			),
		)
		.limit(1);

	if (!record) {
		throw new APIError("NOT_FOUND", {
			message: "That milestone no longer exists.",
		});
	}

	return record;
}
