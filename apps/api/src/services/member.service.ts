import { APIError } from "better-auth/api";
import { inArray } from "drizzle-orm";

import { auth } from "../auth/auth";
import {
	canManageMembers,
	canManageOwners,
	canManageTarget,
	ORG_INVITATION_LIMIT,
	ORG_MEMBERSHIP_LIMIT,
	type OrgRole,
	parseRoleList,
} from "../auth/permissions";
import { adminDb } from "../db";
import { user } from "../db/auth-schema";
import { authErrorMessage, readAuthErrorCode } from "../lib/auth-error";
import type { TenantContext } from "../middleware/tenant";

/**
 * Member reads and writes for the Members page.
 *
 * Why a service: the routes are thin, and the permission rules (an admin
 * manages members only, nobody edits their own role, the last owner survives)
 * have to be identical for single and bulk actions. Keeping them here means a
 * bulk action cannot drift from the single action that the UI also offers.
 *
 * Better Auth's organization tables are read through its API, not joined into
 * business queries. The one direct read is `user.emailVerified`, which the
 * member list response does not include; it is a read only lookup in
 * src/services/organization.service.ts style.
 *
 * Used by: src/routes/members.ts.
 */

/** One row the Members table renders. Dates are ISO strings for the wire. */
export type MemberRow = {
	id: string;
	userId: string;
	role: string;
	createdAt: string;
	name: string;
	email: string;
	image: string | null;
	emailVerified: boolean;
	isSelf: boolean;
	isOwner: boolean;
};

/** Capabilities of the caller, so the UI never guesses from a role string. */
export type MemberViewer = {
	memberId: string;
	role: string;
	canManage: boolean;
	canManageOwners: boolean;
};

export type MemberListResult = {
	organizationId: string;
	members: MemberRow[];
	viewer: MemberViewer;
	/**
	 * Null for plain members. Invitation data is manager only, so the members
	 * page shows the pending chip to owners and admins exclusively.
	 */
	pendingInvitationCount: number | null;
	limits: { membership: number; invitation: number };
	/**
	 * A non-overlapping breakdown. `total` is everyone, `owners` and `admins`
	 * are those roles, and `members` is the remainder. Counting all rows as
	 * "members" made the members card read 3 while only one person was a plain
	 * member.
	 */
	counts: { total: number; members: number; admins: number; owners: number };
};

/** One outcome in a bulk response. Partial failure is a normal result. */
export type BulkItemResult = {
	key: string;
	label: string;
	status:
		| "invited"
		| "resent"
		| "removed"
		| "canceled"
		| "updated"
		| "skipped"
		| "failed";
	code?: string;
	message: string;
};

export type BulkResult = { results: BulkItemResult[] };

/** Roles the members page can assign in a single request. */
export type AssignableMemberRole = Exclude<OrgRole, "owner">;

/** Refuse anything below owner or admin before doing any work. */
function assertManager(role: string): void {
	if (!canManageMembers(role)) {
		throw new APIError("FORBIDDEN", {
			message: "You do not have permission to manage members.",
		});
	}
}

/**
 * Read the member list once, through Better Auth.
 *
 * Every mutation below needs the target's current role and the owner count, so
 * one list call per request is both cheaper and more consistent than one
 * lookup per selected row.
 */
async function loadRawMembers(tenant: TenantContext, headers: Headers) {
	const { members } = await auth.api.listMembers({
		query: {
			organizationId: tenant.organizationId,
			limit: ORG_MEMBERSHIP_LIMIT,
		},
		headers,
	});

	return members;
}

type RawMember = Awaited<ReturnType<typeof loadRawMembers>>[number];

/** Look up verification state in one query, since listMembers omits it. */
async function loadVerifiedMap(
	userIds: string[],
): Promise<Map<string, boolean>> {
	if (userIds.length === 0) return new Map();

	const rows = await adminDb
		.select({ id: user.id, emailVerified: user.emailVerified })
		.from(user)
		.where(inArray(user.id, userIds));

	return new Map(rows.map((row) => [row.id, row.emailVerified]));
}

/** True when the member holds the owner role, including multi-role strings. */
function isOwnerRole(role: string): boolean {
	return parseRoleList(role).includes("owner");
}

/** Human label for a bulk result. */
function labelFor(member: RawMember): string {
	return member.user.name || member.user.email;
}

/** Map one Better Auth member into the wire shape the table consumes. */
function toMemberRow(
	member: RawMember,
	tenant: TenantContext,
	verified: Map<string, boolean>,
): MemberRow {
	return {
		id: member.id,
		userId: member.userId,
		role: member.role,
		createdAt: new Date(member.createdAt).toISOString(),
		name: member.user.name || member.user.email,
		email: member.user.email,
		image: member.user.image ?? null,
		emailVerified: verified.get(member.userId) ?? false,
		isSelf: member.userId === tenant.userId,
		isOwner: isOwnerRole(member.role),
	};
}

/**
 * The members page payload.
 *
 * One request returns the rows, the caller's capabilities, the seat limits and
 * the counts. The page would otherwise need three round trips and could render
 * a count from one snapshot next to a table from another.
 */
export async function listMembers(
	tenant: TenantContext,
	headers: Headers,
): Promise<MemberListResult> {
	const rawMembers = await loadRawMembers(tenant, headers);
	const verified = await loadVerifiedMap(rawMembers.map((m) => m.userId));
	const members = rawMembers.map((member) =>
		toMemberRow(member, tenant, verified),
	);
	const viewerRaw = rawMembers.find(
		(member) => member.userId === tenant.userId,
	);
	const canManage = canManageMembers(tenant.role);

	let pendingInvitationCount: number | null = null;

	if (canManage) {
		const invitations = await auth.api.listInvitations({
			query: { organizationId: tenant.organizationId },
			headers,
		});
		const now = Date.now();

		pendingInvitationCount = invitations.filter(
			(invitation) =>
				invitation.status === "pending" &&
				new Date(invitation.expiresAt).getTime() > now,
		).length;
	}

	// A person with several roles counts once, in the highest role they hold.
	const ownerCount = members.filter((member) => member.isOwner).length;
	const adminCount = members.filter(
		(member) => !member.isOwner && parseRoleList(member.role).includes("admin"),
	).length;

	return {
		organizationId: tenant.organizationId,
		members,
		viewer: {
			memberId: viewerRaw?.id ?? "",
			role: tenant.role,
			canManage,
			canManageOwners: canManageOwners(tenant.role),
		},
		pendingInvitationCount,
		limits: {
			membership: ORG_MEMBERSHIP_LIMIT,
			invitation: ORG_INVITATION_LIMIT,
		},
		counts: {
			total: members.length,
			members: members.length - ownerCount - adminCount,
			admins: adminCount,
			owners: ownerCount,
		},
	};
}

/**
 * Validate one role change against the product rules.
 *
 * Returns a skip reason instead of throwing so a bulk request can report the
 * blocked rows and still succeed for the rest.
 */
function checkRoleChange(
	tenant: TenantContext,
	member: RawMember,
	role: AssignableMemberRole | OrgRole,
): string | null {
	if (member.userId === tenant.userId) {
		return "You cannot change your own role. Ask another owner to do it.";
	}

	if (!canManageTarget(tenant.role, member.role)) {
		return "Only an owner can change an admin or an owner.";
	}

	if (role === "owner" && !canManageOwners(tenant.role)) {
		return "Only an owner can promote someone to owner.";
	}

	return null;
}

/** Single role change, used by the inline select in the members table. */
export async function updateMemberRole(
	tenant: TenantContext,
	headers: Headers,
	memberId: string,
	role: OrgRole,
): Promise<{ id: string; role: string }> {
	assertManager(tenant.role);

	const rawMembers = await loadRawMembers(tenant, headers);
	const member = rawMembers.find((item) => item.id === memberId);

	if (!member) {
		throw new APIError("NOT_FOUND", {
			message: "That member is no longer part of this workspace.",
		});
	}

	const blocked = checkRoleChange(tenant, member, role);
	if (blocked) {
		throw new APIError("BAD_REQUEST", { message: blocked });
	}

	const updated = await auth.api.updateMemberRole({
		body: {
			memberId,
			role,
			organizationId: tenant.organizationId,
		},
		headers,
	});

	return { id: updated.id, role: updated.role };
}

/**
 * Bulk role change.
 *
 * Owner is excluded on purpose. Promotion to owner is a single row action with
 * its own confirmation, so a select-all can never create a second owner by
 * accident.
 */
export async function bulkUpdateMemberRole(
	tenant: TenantContext,
	headers: Headers,
	memberIds: string[],
	role: AssignableMemberRole,
): Promise<BulkResult> {
	assertManager(tenant.role);

	const rawMembers = await loadRawMembers(tenant, headers);
	const byId = new Map(rawMembers.map((member) => [member.id, member]));
	const results: BulkItemResult[] = [];

	for (const memberId of memberIds) {
		const member = byId.get(memberId);

		if (!member) {
			results.push({
				key: memberId,
				label: memberId,
				status: "failed",
				code: "MEMBER_NOT_FOUND",
				message: "That member is no longer part of this workspace.",
			});
			continue;
		}

		const blocked = checkRoleChange(tenant, member, role);

		if (blocked) {
			results.push({
				key: memberId,
				label: labelFor(member),
				status: "skipped",
				message: blocked,
			});
			continue;
		}

		try {
			await auth.api.updateMemberRole({
				body: { memberId, role, organizationId: tenant.organizationId },
				headers,
			});

			results.push({
				key: memberId,
				label: labelFor(member),
				status: "updated",
				message: `Role changed to ${role}.`,
			});
		} catch (error) {
			results.push({
				key: memberId,
				label: labelFor(member),
				status: "failed",
				code: readAuthErrorCode(error) ?? undefined,
				message: authErrorMessage(error, "Could not change that role."),
			});
		}
	}

	return { results };
}

/**
 * Remove several members in one request.
 *
 * Never removes the caller (the leave flow owns that, because it has to pick a
 * next workspace) and never removes the final owner. Owners are also never
 * removed as part of a batch, so the last owner check has a single, obvious
 * subject.
 */
export async function bulkRemoveMembers(
	tenant: TenantContext,
	headers: Headers,
	memberIds: string[],
): Promise<BulkResult> {
	assertManager(tenant.role);

	const rawMembers = await loadRawMembers(tenant, headers);
	const byId = new Map(rawMembers.map((member) => [member.id, member]));
	const ownerCount = rawMembers.filter((member) =>
		isOwnerRole(member.role),
	).length;
	let ownersRemaining = ownerCount;
	const results: BulkItemResult[] = [];

	for (const memberId of memberIds) {
		const member = byId.get(memberId);

		if (!member) {
			results.push({
				key: memberId,
				label: memberId,
				status: "failed",
				code: "MEMBER_NOT_FOUND",
				message: "That member is no longer part of this workspace.",
			});
			continue;
		}

		if (member.userId === tenant.userId) {
			results.push({
				key: memberId,
				label: labelFor(member),
				status: "skipped",
				message: "Use Leave organization in settings to remove yourself.",
			});
			continue;
		}

		if (!canManageTarget(tenant.role, member.role)) {
			results.push({
				key: memberId,
				label: labelFor(member),
				status: "skipped",
				message: "Only an owner can remove an admin or an owner.",
			});
			continue;
		}

		if (isOwnerRole(member.role) && ownersRemaining <= 1) {
			results.push({
				key: memberId,
				label: labelFor(member),
				status: "skipped",
				message: "A workspace needs at least one owner.",
			});
			continue;
		}

		try {
			await auth.api.removeMember({
				body: {
					memberIdOrEmail: memberId,
					organizationId: tenant.organizationId,
				},
				headers,
			});

			if (isOwnerRole(member.role)) {
				ownersRemaining -= 1;
			}

			results.push({
				key: memberId,
				label: labelFor(member),
				status: "removed",
				message: "Removed from the workspace.",
			});
		} catch (error) {
			results.push({
				key: memberId,
				label: labelFor(member),
				status: "failed",
				code: readAuthErrorCode(error) ?? undefined,
				message: authErrorMessage(error, "Could not remove that member."),
			});
		}
	}

	return { results };
}
