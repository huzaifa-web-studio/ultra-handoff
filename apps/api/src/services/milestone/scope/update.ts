/**
 * Update one scope section.
 *
 * Why this file: writing a test or review note is only allowed on the open
 * round of the current status period. That rule and the write live together.
 *
 * Used by: `routes/milestones.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import {
	canEditChangeScopeEntry,
	canWriteReviewScope,
	canWriteTestScope,
	MILESTONE_LOCKED_MESSAGE,
	validateMilestoneScopeTitle,
} from "../../../auth/milestone-permissions";
import { assertProjectActive } from "../../../auth/project-permissions";
import { milestoneScopeEntry } from "../../../db/schema";
import { withTenant } from "../../../db/tenant";
import { collectMentionKeys } from "../../../lib/mentions";
import { sanitizeRichText } from "../../../lib/rich-text";
import type { TenantContext } from "../../../middleware/tenant";
import { queueDocumentPreviews } from "../../link-preview.service";
import { assertCommentMentions } from "../../mention.service";
import { loadOpenPeriodId } from "../../milestone-phase.service";
import {
	createNotifications,
	deleteNotificationsForRecipient,
	type NotificationDelivery,
} from "../../notification.service";
import { requireMilestoneRecord, requireProjectAccess } from "./access";
import { findEntryRecord, toEntry } from "./payload";
import type {
	MilestoneScopeKind,
	MilestoneScopeUpdateResult,
	UpdateMilestoneScopeEntryInput,
} from "./types";

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
			let removedMentionIds: string[] = [];

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
					const afterMentions = new Set(
						collectMentionKeys(description.value)
							.filter((mention) => mention.type === "user")
							.map((mention) => mention.id),
					);

					addedMentionIds = [...afterMentions].filter(
						(userId) => !beforeMentions.has(userId),
					);
					removedMentionIds = [...beforeMentions].filter(
						(userId) => !afterMentions.has(userId),
					);
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

			// A mention removed by an edit must not keep an unread bell. The
			// dedupe key is stable across edits, so this deletes exactly the row
			// the add path created for that person.
			for (const recipientUserId of removedMentionIds) {
				await deleteNotificationsForRecipient(tx, tenant, recipientUserId, [
					`mention:scope:${entryId}:${recipientUserId}`,
				]);
			}

			const notifications = await createNotifications(
				tx,
				tenant,
				addedMentionIds
					.filter((userId) => userId !== tenant.userId)
					.map((recipientUserId) => ({
						recipientUserId,
						actorUserId: tenant.userId,
						type: "mention" as const,
						// Stable across edits so a re-added mention reuses the one
						// row instead of creating a new unread row every save. The
						// unique index on (recipient, dedupe_key) makes the add
						// idempotent.
						dedupeKey: `mention:scope:${entryId}:${recipientUserId}`,
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
