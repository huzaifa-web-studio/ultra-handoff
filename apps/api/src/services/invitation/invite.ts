/**
 * Bulk invitations.
 *
 * Why this file: sending invitations resolves targets, applies the hourly and
 * total limits and records one result per person. Those steps belong together.
 *
 * Used by: `routes/members.ts`.
 */

import { APIError } from "better-auth/api";
import { auth } from "../../auth/auth";
import {
	assignableInvitationRoles,
	BULK_INVITE_MAX,
	ORG_INVITATION_LIMIT,
	ORG_INVITES_PER_HOUR,
	ORG_MEMBERSHIP_LIMIT,
} from "../../auth/permissions";
import { authErrorMessage, readAuthErrorCode } from "../../lib/auth-error";
import { consumeRateLimit } from "../../lib/rate-limit";
import type { TenantContext } from "../../middleware/tenant";
import type { BulkItemResult, BulkResult } from "../member.service";
import {
	assertManager,
	isValidEmail,
	loadInvitations,
	normalizeEmail,
} from "./helpers";

/** Key for the hourly invite budget of one organization. */
function inviteRateKey(organizationId: string): string {
	const hour = new Date().toISOString().slice(0, 13);

	return `org-invites:${organizationId}:${hour}`;
}

/**
 * Invite several addresses in one request.
 *
 * Not atomic on purpose. One malformed address, one existing member or one
 * already pending invitation must not discard the valid rows, so every address
 * gets its own outcome and the dialog can keep the failures for correction.
 */
export async function bulkInviteMembers(
	tenant: TenantContext,
	headers: Headers,
	emails: string[],
	role: "member" | "admin",
): Promise<BulkResult> {
	assertManager(tenant.role);

	if (!assignableInvitationRoles(tenant.role).includes(role)) {
		throw new APIError("FORBIDDEN", {
			message: "Only an owner can invite someone as an admin.",
		});
	}

	const allowed = await consumeRateLimit(
		inviteRateKey(tenant.organizationId),
		ORG_INVITES_PER_HOUR,
		60 * 60,
	);

	if (!allowed) {
		throw new APIError("TOO_MANY_REQUESTS", {
			message: "Too many invitations this hour. Wait a little and try again.",
		});
	}

	const results: BulkItemResult[] = [];
	const seen = new Set<string>();

	// One list read for members and one for invitations, reused for every row.
	const { members } = await auth.api.listMembers({
		query: {
			organizationId: tenant.organizationId,
			limit: ORG_MEMBERSHIP_LIMIT,
		},
		headers,
	});
	const invitations = await loadInvitations(tenant, headers);
	const memberEmails = new Set(
		members.map((member) => member.user.email.toLowerCase()),
	);
	const now = Date.now();
	const pendingRows = invitations.filter((row) => row.status === "pending");
	// Live pending invitations already hold a seat and an invitation slot.
	const livePendingEmails = new Set(
		pendingRows
			.filter((row) => new Date(row.expiresAt).getTime() > now)
			.map((row) => row.email.toLowerCase()),
	);
	// Expired pending rows are resend targets. Resending one makes it live
	// again, so it still needs capacity, but it should read as "resent".
	const anyPendingEmails = new Set(
		pendingRows.map((row) => row.email.toLowerCase()),
	);

	// Seats are counted against members plus live pending invitations, so a
	// batch cannot promise seats that acceptance would later refuse.
	let projectedSeats = members.length + livePendingEmails.size;
	let projectedPending = livePendingEmails.size;

	for (const rawEmail of emails.slice(0, BULK_INVITE_MAX)) {
		const email = normalizeEmail(rawEmail);

		if (!isValidEmail(email)) {
			results.push({
				key: rawEmail,
				label: rawEmail,
				status: "failed",
				code: "INVALID_EMAIL",
				message: "That does not look like an email address.",
			});
			continue;
		}

		if (seen.has(email)) {
			results.push({
				key: email,
				label: email,
				status: "skipped",
				code: "DUPLICATE",
				message: "Listed more than once in this batch.",
			});
			continue;
		}

		seen.add(email);

		if (memberEmails.has(email)) {
			results.push({
				key: email,
				label: email,
				status: "failed",
				code: "ALREADY_MEMBER",
				message: "Already a member of this organization.",
			});
			continue;
		}

		const isLiveResend = livePendingEmails.has(email);
		const isResend = anyPendingEmails.has(email);
		// A live pending row already holds capacity. A new address, or an
		// expired row being brought back to life, needs a free slot.
		const needsCapacity = !isLiveResend;

		if (needsCapacity) {
			if (projectedSeats >= ORG_MEMBERSHIP_LIMIT) {
				results.push({
					key: email,
					label: email,
					status: "skipped",
					code: "MEMBERSHIP_LIMIT",
					message: `No seats left. This organization allows ${ORG_MEMBERSHIP_LIMIT} members.`,
				});
				continue;
			}

			if (projectedPending >= ORG_INVITATION_LIMIT) {
				results.push({
					key: email,
					label: email,
					status: "skipped",
					code: "INVITATION_LIMIT",
					message: `There are already ${ORG_INVITATION_LIMIT} pending invitations.`,
				});
				continue;
			}
		}

		try {
			await auth.api.createInvitation({
				body: {
					email,
					role,
					organizationId: tenant.organizationId,
					// A repeat invite refreshes the expiry and sends a new message
					// instead of failing or leaving two live links.
					resend: true,
				},
				headers,
			});

			if (needsCapacity) {
				projectedSeats += 1;
				projectedPending += 1;
			}

			results.push({
				key: email,
				label: email,
				status: isResend ? "resent" : "invited",
				message: isResend
					? "Invitation resent."
					: "Invitation created. The email is queued.",
			});
		} catch (error) {
			results.push({
				key: email,
				label: email,
				status: "failed",
				code: readAuthErrorCode(error) ?? undefined,
				message: authErrorMessage(error, "Could not send the invitation."),
			});
		}
	}

	return { results };
}
