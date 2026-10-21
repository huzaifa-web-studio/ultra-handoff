import { APIError } from "better-auth/api";
import { eq, inArray } from "drizzle-orm";

import { auth } from "../auth/auth";
import {
	assignableInvitationRoles,
	BULK_INVITE_MAX,
	canManageMembers,
	canManageOwners,
	MAGIC_LINK_COOLDOWN_SECONDS,
	ORG_INVITATION_LIMIT,
	ORG_INVITES_PER_HOUR,
	ORG_MEMBERSHIP_LIMIT,
	type OrgRole,
	parseRoleList,
} from "../auth/permissions";
import { adminDb } from "../db";
import { invitation, organization, user } from "../db/auth-schema";
import { authErrorMessage, readAuthErrorCode } from "../lib/auth-error";
import { serverEnv } from "../lib/env";
import { consumeRateLimit, startCooldown } from "../lib/rate-limit";
import type { TenantContext } from "../middleware/tenant";
import type { BulkItemResult, BulkResult } from "./member.service";

/**
 * Invitation lifecycle for the Invitations page and the public accept page.
 *
 * Why a service: resend, cancel and invite share the same guards (manager only,
 * admin cannot touch an admin or owner invitation, pending only), and the same
 * per item result contract as the member service. Reads go through Better Auth's
 * `listInvitations`; the public preview has no session to offer, so it uses two
 * narrow read only lookups instead (see `previewInvitation`).
 *
 * Used by: src/routes/members.ts and src/routes/invitations.ts.
 */

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

/** Refuse anything below owner or admin before doing any work. */
function assertManager(role: string): void {
	if (!canManageMembers(role)) {
		throw new APIError("FORBIDDEN", {
			message: "You do not have permission to manage invitations.",
		});
	}
}

/** A pending row past its expiry reads as expired, without a cron job. */
function deriveStatus(row: {
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
function maskEmail(email: string): string {
	const [local, domain] = email.split("@");

	if (!local || !domain) return "***";

	return `${local.slice(0, 1)}***@${domain}`;
}

/** Shared normalisation for every address that reaches Better Auth. */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Deliberately simple. The server is the authority, the UI mirrors it. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
	return email.length <= 254 && EMAIL_PATTERN.test(email);
}

/** The name Better Auth stores when a magic link creates the account. */
function nameFromEmail(email: string): string {
	const local = email.split("@")[0] ?? "Teammate";

	return local.replace(/[._-]+/g, " ").trim() || "Teammate";
}

/** Load inviter identity for the history rows in one query. */
async function loadUsers(userIds: string[]) {
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
async function loadInvitations(tenant: TenantContext, headers: Headers) {
	return auth.api.listInvitations({
		query: { organizationId: tenant.organizationId },
		headers,
	});
}

/** Capabilities for acting on one invitation row. */
function canManageInvitation(
	actorRole: string,
	invitationRole: string,
): boolean {
	if (canManageOwners(actorRole)) return true;

	return !parseRoleList(invitationRole).some(
		(value) => value === "owner" || value === "admin",
	);
}

/**
 * Paginated invitation history.
 *
 * Filtering, sorting and paging happen on the server over the full set, so the
 * status counts always describe the workspace, not the current page. The source
 * list comes from Better Auth and grows with total invitations, while its own
 * limit only caps pending ones.
 */
export async function listInvitationHistory(
	tenant: TenantContext,
	headers: Headers,
	query: InvitationHistoryQuery,
): Promise<InvitationHistoryResult> {
	assertManager(tenant.role);

	const rows = await loadInvitations(tenant, headers);
	const inviterIds = [...new Set(rows.map((row) => row.inviterId))];
	const inviters = await loadUsers(inviterIds);

	const items: InvitationHistoryItem[] = rows.map((row) => {
		const inviter = inviters.get(row.inviterId);

		return {
			id: row.id,
			email: row.email,
			role: row.role ?? "member",
			status: deriveStatus(row),
			createdAt: new Date(row.createdAt).toISOString(),
			expiresAt: new Date(row.expiresAt).toISOString(),
			inviterName: inviter?.name || inviter?.email || "Former member",
			inviterEmail: inviter?.email ?? "",
		};
	});

	const counts: InvitationHistoryResult["counts"] = {
		all: items.length,
		pending: 0,
		expired: 0,
		accepted: 0,
		canceled: 0,
		rejected: 0,
	};

	for (const item of items) {
		counts[item.status] += 1;
	}

	const search = query.search.trim().toLowerCase();
	const filtered = items.filter((item) => {
		const matchesStatus =
			query.status === "all" || item.status === query.status;
		// The Role column shows the first role, so the filter matches that.
		const primaryRole = parseRoleList(item.role)[0] ?? "member";
		const matchesRole = query.role === "all" || primaryRole === query.role;
		const matchesSearch =
			search.length === 0 || item.email.toLowerCase().includes(search);

		return matchesStatus && matchesRole && matchesSearch;
	});

	const direction = query.direction === "asc" ? 1 : -1;
	const sorted = [...filtered].sort((a, b) => {
		switch (query.sort) {
			case "email":
				return a.email.localeCompare(b.email) * direction;
			case "expiresAt":
				return (
					(new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()) *
					direction
				);
			case "status":
				return a.status.localeCompare(b.status) * direction;
			default:
				return (
					(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
					direction
				);
		}
	});

	const total = sorted.length;
	const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
	const page = Math.min(Math.max(1, query.page), totalPages);
	const start = (page - 1) * query.pageSize;

	return {
		organizationId: tenant.organizationId,
		items: sorted.slice(start, start + query.pageSize),
		pagination: {
			page,
			pageSize: query.pageSize,
			total,
			totalPages,
			hasNext: page < totalPages,
			hasPrevious: page > 1,
		},
		counts,
		viewer: { role: tenant.role },
	};
}

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
				message: "Already a member of this workspace.",
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
					message: `No seats left. This workspace allows ${ORG_MEMBERSHIP_LIMIT} members.`,
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

/**
 * Public preview for the accept page.
 *
 * Why not Better Auth's `getInvitation`: it requires a signed in session whose
 * email matches, and the page has to explain the invitation before the visitor
 * signs in. This reads one invitation and two labels by id, exposes no email
 * beyond a mask, and never mutates anything. The invite link is the bearer
 * token, so possessing it is the intended access.
 */
export async function previewInvitation(
	invitationId: string,
	headers: Headers,
): Promise<InvitationPreview | null> {
	const [row] = await adminDb
		.select()
		.from(invitation)
		.where(eq(invitation.id, invitationId))
		.limit(1);

	if (!row) return null;

	const [workspace] = await adminDb
		.select({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
		})
		.from(organization)
		.where(eq(organization.id, row.organizationId))
		.limit(1);

	if (!workspace) return null;

	const [inviter] = await adminDb
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, row.inviterId))
		.limit(1);

	const status = deriveStatus(row);

	// The browser session decides the next step, but never reveals the target
	// address. An anonymous visitor gets null rather than false so the page can
	// distinguish "not signed in" from "signed in as someone else".
	const session = await auth.api.getSession({ headers });
	const emailMatches = session
		? session.user.email.toLowerCase() === row.email.toLowerCase()
		: null;

	return {
		invitationId: row.id,
		organizationId: workspace.id,
		organizationName: workspace.name,
		organizationSlug: workspace.slug,
		inviterName: inviter?.name || inviter?.email || "A teammate",
		role: row.role ?? "member",
		status,
		maskedEmail: maskEmail(row.email),
		expiresAt: new Date(row.expiresAt).toISOString(),
		viewer: {
			signedIn: Boolean(session),
			emailMatches,
			emailVerified: session?.user.emailVerified ?? false,
		},
	};
}

/**
 * Send a magic link to the invited address.
 *
 * The address always comes from the invitation row, never from the request, so
 * the endpoint cannot be used to email an arbitrary stranger. The per
 * invitation cooldown stops one link holder from repeatedly mailing the same
 * inbox.
 */
export async function sendInvitationMagicLink(
	invitationId: string,
	headers: Headers,
): Promise<{ status: "sent" }> {
	const [row] = await adminDb
		.select()
		.from(invitation)
		.where(eq(invitation.id, invitationId))
		.limit(1);

	if (!row) {
		throw new APIError("NOT_FOUND", {
			message: "This invitation link is not valid.",
		});
	}

	const status = deriveStatus(row);

	if (status === "expired") {
		throw new APIError("BAD_REQUEST", {
			message: "This invitation has expired. Ask an admin to resend it.",
		});
	}

	if (status !== "pending") {
		throw new APIError("BAD_REQUEST", {
			message: "This invitation is no longer available.",
		});
	}

	const allowed = await startCooldown(
		`invite-magic:${invitationId}`,
		MAGIC_LINK_COOLDOWN_SECONDS,
	);

	if (!allowed) {
		throw new APIError("TOO_MANY_REQUESTS", {
			message: "A sign-in link was just sent. Check your inbox.",
		});
	}

	await auth.api.signInMagicLink({
		body: {
			email: row.email,
			name: nameFromEmail(row.email),
			callbackURL: `${serverEnv.webUrl}/invite/${encodeURIComponent(invitationId)}?verify=1`,
			errorCallbackURL: `${serverEnv.webUrl}/auth/error`,
			metadata: { invitationId },
		},
		headers,
	});

	return { status: "sent" };
}

/** Re-exported so routes can type the body without importing permissions. */
export type InvitationRole = Extract<OrgRole, "member" | "admin">;
