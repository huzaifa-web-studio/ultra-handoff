/**
 * Invitation wire shapes.
 *
 * Why this file: the invitations page and the public accept page name the same
 * history and preview shapes, so they live together.
 *
 * Used by: every module in `services/invitation/` and the member routes.
 */

import type { OrgRole } from "../../auth/permissions";

export type InvitationStatus =
	| "pending"
	| "expired"
	| "accepted"
	| "canceled"
	| "rejected";

export type InvitationHistoryItem = {
	id: string;
	email: string;
	role: string;
	status: InvitationStatus;
	createdAt: string;
	expiresAt: string;
	inviterName: string;
	inviterEmail: string;
};

export type InvitationHistoryQuery = {
	status: "all" | InvitationStatus;
	/** Filter by the role the invitation grants. */
	role: "all" | OrgRole;
	search: string;
	page: number;
	pageSize: number;
	sort: "createdAt" | "expiresAt" | "email" | "status";
	direction: "asc" | "desc";
};

export type InvitationHistoryResult = {
	organizationId: string;
	items: InvitationHistoryItem[];
	pagination: {
		page: number;
		pageSize: number;
		total: number;
		totalPages: number;
		hasNext: boolean;
		hasPrevious: boolean;
	};
	/**
	 * Counts within the current role and search scope. The status filter is
	 * intentionally not applied, so every status option keeps a useful number
	 * while one status is selected.
	 */
	counts: Record<"all" | InvitationStatus, number>;
	/** The caller's role, so the invite dialog offers the right roles. */
	viewer: { role: string };
};

/** Public view of an invitation, safe for the accept page. */
export type InvitationPreview = {
	invitationId: string;
	organizationId: string;
	organizationName: string;
	organizationSlug: string;
	inviterName: string;
	role: string;
	status: "pending" | "expired" | "accepted" | "canceled" | "rejected";
	maskedEmail: string;
	expiresAt: string;
	/**
	 * What the current browser may do next.
	 *
	 * The invited address is never returned, so the page cannot compare it
	 * itself. These flags let it show the right state without leaking the
	 * address: signed out, wrong account, unverified, or ready to accept.
	 */
	viewer: {
		signedIn: boolean;
		emailMatches: boolean | null;
		emailVerified: boolean;
	};
};

/** Re-exported so routes can type the body without importing permissions. */
export type InvitationRole = Extract<OrgRole, "member" | "admin">;
