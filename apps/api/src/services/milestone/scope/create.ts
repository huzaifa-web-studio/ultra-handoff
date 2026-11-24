/**
 * Create scope sections.
 *
 * Why this file: a change acceptance and a status round both add a named
 * section, and both must pick the same round number. Keeping them together
 * means the numbering cannot drift.
 *
 * Used by: `services/milestone/` and `services/change-request/`.
 */

import { and, eq, max } from "drizzle-orm";
import { validateMilestoneScopeTitle } from "../../../auth/milestone-permissions";
import { milestoneScopeEntry } from "../../../db/schema";
import type { TenantTx } from "../../../db/tenant";
import { sanitizeRichText } from "../../../lib/rich-text";
import type { TenantContext } from "../../../middleware/tenant";
import { assertCommentMentions } from "../../mention.service";
import { insertScopeEntry } from "./payload";
import type { MilestoneScopeEntryRecord } from "./types";

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
