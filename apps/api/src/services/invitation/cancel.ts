/**
 * Bulk invitation cancellation.
 *
 * Why this file: cancelling marks pending invitations canceled and reports one
 * result per item, matching the resend contract.
 *
 * Used by: `routes/members.ts`.
 */

import { auth } from "../../auth/auth";
import { authErrorMessage, readAuthErrorCode } from "../../lib/auth-error";
import type { TenantContext } from "../../middleware/tenant";
import type { BulkItemResult, BulkResult } from "../member.service";
import {
	assertManager,
	canManageInvitation,
	deriveStatus,
	loadInvitations,
} from "./helpers";

/** Cancel selected pending invitations. */
export async function bulkCancelInvitations(
	tenant: TenantContext,
	headers: Headers,
	invitationIds: string[],
): Promise<BulkResult> {
	assertManager(tenant.role);

	const rows = await loadInvitations(tenant, headers);
	const byId = new Map(rows.map((row) => [row.id, row]));
	const results: BulkItemResult[] = [];

	for (const invitationId of invitationIds) {
		const row = byId.get(invitationId);

		if (!row) {
			results.push({
				key: invitationId,
				label: invitationId,
				status: "failed",
				code: "INVITATION_NOT_FOUND",
				message: "That invitation is no longer available.",
			});
			continue;
		}

		if (deriveStatus(row) !== "pending" && deriveStatus(row) !== "expired") {
			results.push({
				key: invitationId,
				label: row.email,
				status: "skipped",
				message: "Only a pending or expired invitation can be canceled.",
			});
			continue;
		}

		if (!canManageInvitation(tenant.role, row.role ?? "member")) {
			results.push({
				key: invitationId,
				label: row.email,
				status: "skipped",
				message: "Only an owner can cancel an admin invitation.",
			});
			continue;
		}

		try {
			await auth.api.cancelInvitation({
				body: { invitationId },
				headers,
			});

			results.push({
				key: invitationId,
				label: row.email,
				status: "canceled",
				message: "Invitation canceled.",
			});
		} catch (error) {
			results.push({
				key: invitationId,
				label: row.email,
				status: "failed",
				code: readAuthErrorCode(error) ?? undefined,
				message: authErrorMessage(error, "Could not cancel the invitation."),
			});
		}
	}

	return { results };
}
