/**
 * Invitation guards, status derivation and read helpers.
 *
 * Why this file: the history page, the bulk actions and the public preview all
 * derive the same status from the same timestamps, and the manager and target
 * rules must answer the same way. They live here.
 *
 * Used by: every read and write module in `services/invitation/`.
 */

import { APIError } from "better-auth/api";
import { eq, inArray, type SQL, sql } from "drizzle-orm";
import { auth } from "../../auth/auth";
import {
	canManageMembers,
	canManageOwners,
	parseRoleList,
} from "../../auth/permissions";
import { adminDb } from "../../db";
import { invitation, user } from "../../db/auth-schema";
import type { TenantContext } from "../../middleware/tenant";
import type { InvitationStatus } from "./types";

/** Refuse anything below owner or admin before doing any work. */
export function assertManager(role: string): void {
	if (!canManageMembers(role)) {
		throw new APIError("FORBIDDEN", {
			message: "You do not have permission to manage invitations.",
		});
	}
}

/** A pending row past its expiry reads as expired, without a cron job. */
export function deriveStatus(row: {
	status: string;
	expiresAt: Date | string;
}): InvitationStatus {
	if (
		row.status === "pending" &&
		new Date(row.expiresAt).getTime() <= Date.now()
	) {
		return "expired";
	}

	if (
		row.status === "accepted" ||
		row.status === "canceled" ||
		row.status === "rejected"
	) {
		return row.status;
	}

	return "pending";
}

/** `ayesha@studio.com` becomes `a***@studio.com`. */
export function maskEmail(email: string): string {
	const [local, domain] = email.split("@");

	if (!local || !domain) return "***";

	return `${local.slice(0, 1)}***@${domain}`;
}

/** Shared normalisation for every address that reaches Better Auth. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Deliberately simple. The server is the authority, the UI mirrors it. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
	return email.length <= 254 && EMAIL_PATTERN.test(email);
}

/** The name Better Auth stores when a magic link creates the account. */
export function nameFromEmail(email: string): string {
	const local = email.split("@")[0] ?? "Teammate";

	return local.replace(/[._-]+/g, " ").trim() || "Teammate";
}

/** Load inviter identity for the history rows in one query. */
export async function loadUsers(userIds: string[]) {
	if (userIds.length === 0)
		return new Map<string, { name: string; email: string }>();

	const rows = await adminDb
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(inArray(user.id, userIds));

	return new Map(
		rows.map((row) => [row.id, { name: row.name, email: row.email }]),
	);
}

/** Load every invitation row for the workspace through Better Auth. */
export async function loadInvitations(tenant: TenantContext, headers: Headers) {
	return auth.api.listInvitations({
		query: { organizationId: tenant.organizationId },
		headers,
	});
}

/** Capabilities for acting on one invitation row. */
export function canManageInvitation(
	actorRole: string,
	invitationRole: string,
): boolean {
	if (canManageOwners(actorRole)) return true;

	return !parseRoleList(invitationRole).some(
		(value) => value === "owner" || value === "admin",
	);
}

/** The status a row shows, including a pending row that has expired. */
export function derivedStatusSql(): SQL<string> {
	return sql<string>`case
		when ${invitation.status} = 'pending' and ${invitation.expiresAt} <= now() then 'expired'
		when ${invitation.status} in ('accepted', 'canceled', 'rejected') then ${invitation.status}
		else 'pending'
	end`;
}

/** SQL predicate for one status option, matching `deriveStatus`. */
export function statusFilterSql(status: InvitationStatus): SQL {
	switch (status) {
		case "pending":
			return sql`${invitation.status} = 'pending' and ${invitation.expiresAt} > now()`;
		case "expired":
			return sql`${invitation.status} = 'pending' and ${invitation.expiresAt} <= now()`;
		default:
			return eq(invitation.status, status);
	}
}
