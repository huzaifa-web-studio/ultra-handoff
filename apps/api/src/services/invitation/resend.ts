/**
 * Bulk invitation resends.
 *
 * Why this file: a resend touches only a pending invitation and rotates its
 * expiry, so it shares the invitation guards but not the create path.
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

/**
 * Resend selected invitations.
 *
 * Better Auth's `resend` refreshes the existing row instead of creating a new
 * one, so the history keeps a single entry with a new expiry.
 */
export async function bulkResendInvitations(
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

		if (deriveStatus(row) === "accepted") {
			results.push({
				key: invitationId,
				label: row.email,
				status: "skipped",
				message: "That invitation was already accepted.",
			});
			continue;
		}

		if (deriveStatus(row) === "canceled" || deriveStatus(row) === "rejected") {
			results.push({
				key: invitationId,
				label: row.email,
				status: "skipped",
				message: "Invite this person again instead of resending.",
			});
			continue;
		}

		if (!canManageInvitation(tenant.role, row.role ?? "member")) {
			results.push({
				key: invitationId,
				label: row.email,
				status: "skipped",
				message: "Only an owner can resend an admin invitation.",
			});
			continue;
		}

		try {
			await auth.api.createInvitation({
				body: {
					email: row.email,
					role: row.role ?? "member",
					organizationId: tenant.organizationId,
					resend: true,
				},
				headers,
			});

			results.push({
				key: invitationId,
				label: row.email,
				status: "resent",
				message: "Invitation resent.",
			});
		} catch (error) {
			results.push({
				key: invitationId,
				label: row.email,
				status: "failed",
				code: readAuthErrorCode(error) ?? undefined,
				message: authErrorMessage(error, "Could not resend the invitation."),
			});
		}
	}

	return { results };
}
