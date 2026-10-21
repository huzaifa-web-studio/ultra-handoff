/**
 * Organization role helpers for the web app.
 *
 * Why a small local map: the browser needs the role names to render selects
 * and to hide controls the caller cannot use. It never enforces anything:
 * Better Auth checks the real permission on every write.
 *
 * Used by: the organization settings feature and, later, the members page.
 */

/** The only roles an organization member can hold. */
export const ORG_ROLES = ["owner", "admin", "member"] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

/** Human readable labels for the role select and the settings header. */
export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
	owner: "Owner",
	admin: "Admin",
	member: "Member",
};

/**
 * Split a role value into its parts.
 *
 * Better Auth stores multiple roles as a comma separated string. The UI only
 * assigns one at a time, but the read path must not break on a legacy value.
 */
export function roleParts(role: string | null | undefined): string[] {
	if (!role) return [];

	return role
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

/** True when the role can change the organization profile or its logo. */
export function isOrganizationEditor(role: string | null | undefined): boolean {
	return roleParts(role).some(
		(value) => value === "owner" || value === "admin",
	);
}

/** True when the role may invite, remove and re-role other members. */
export function canManageMembers(role: string | null | undefined): boolean {
	return isOrganizationEditor(role);
}

/** True when the role may manage owners and other admins. */
export function canManageOwners(role: string | null | undefined): boolean {
	return isOrganizationOwner(role);
}

/**
 * True when the actor may modify that member.
 *
 * Product rule, mirrored from the API: an admin manages members only, so
 * owners and admins are read only to them.
 */
export function canManageTarget(
	actorRole: string | null | undefined,
	targetRole: string | null | undefined,
): boolean {
	if (canManageOwners(actorRole)) return true;

	const parts = roleParts(targetRole);

	return parts.length > 0 && parts.every((value) => value === "member");
}

/**
 * Roles an actor may assign.
 *
 * Owner is only offered in the single row confirmation flow, never in bulk and
 * never in an invitation, which is why it is listed separately.
 */
export function assignableMemberRoles(
	actorRole: string | null | undefined,
): OrgRole[] {
	return canManageOwners(actorRole)
		? ["member", "admin", "owner"]
		: ["member", "admin"];
}

/** Roles an actor may send in an invitation. */
export function assignableInvitationRoles(
	actorRole: string | null | undefined,
): Array<Extract<OrgRole, "member" | "admin">> {
	return canManageOwners(actorRole) ? ["member", "admin"] : ["member"];
}

/** True when the role is the organization's owner. */
export function isOrganizationOwner(role: string | null | undefined): boolean {
	return roleParts(role).includes("owner");
}

/** Label for the role badge, falling back to the raw value. */
export function organizationRoleLabel(role: string | null | undefined): string {
	if (!role) return "Member";

	const first = roleParts(role)[0];

	if (!first) return "Member";

	return ORG_ROLE_LABELS[first as OrgRole] ?? first;
}
