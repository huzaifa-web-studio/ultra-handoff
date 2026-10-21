/**
 * Organization role and slug rules.
 *
 * Why this file exists: Better Auth ships `owner`, `admin` and `member`, which
 * is exactly the Handoff role model. The plugin's defaults already give admin
 * the organization update and member management permissions we need, and give
 * member read only access. This module only keeps the parts the library does
 * not provide: an explicit role allowlist and the slug rules the web router
 * needs.
 *
 * Server only. The browser hides controls based on the caller's role, but
 * Better Auth remains authoritative on every write.
 *
 * Used by: src/auth/auth.ts, src/routes/uploads.ts and
 * src/routes/organization.ts.
 */

import { APIError } from "better-auth/api";

/** The only roles an organization member can hold. */
export const ORG_ROLES = ["owner", "admin", "member"] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

/** Roles allowed to change the organization profile or its logo. */
export const ORG_SETTINGS_ROLES = ["owner", "admin"] as const;

/**
 * Organization capacity limits.
 *
 * Why constants: the organization plugin enforces these numbers on every
 * write, and the members and invitations pages quote them back to the user
 * ("14 of 100 seats used"). Keeping one source prevents the UI from promising
 * something the library will reject.
 */
export const ORG_MEMBERSHIP_LIMIT = 100;
export const ORG_INVITATION_LIMIT = 100;

/** An invitation stays valid for one week. The email states the same window. */
export const ORG_INVITATION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Largest batch accepted by a bulk invite or bulk member action. */
export const BULK_INVITE_MAX = 25;
export const BULK_SELECTION_MAX = 100;

/** Invitations one organization may send per hour, on top of Better Auth limits. */
export const ORG_INVITES_PER_HOUR = 100;

/** Magic links are short lived and can only be requested once a minute. */
export const MAGIC_LINK_TTL_SECONDS = 60 * 10;
export const MAGIC_LINK_COOLDOWN_SECONDS = 60;

/**
 * Slugs that would collide with a root level web route or an API prefix.
 *
 * An organization lives at `/<slug>`, so a slug like `account` would make the
 * organization dashboard unreachable behind the account page.
 */
export const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set([
	"account",
	"auth",
	"api",
	"delete-account",
	"reset-password",
	"settings",
	"invite",
	"accept-invitation",
	"health",
	"files",
	"uploads",
]);

/** Matches the slug shape the router and the branding rules expect. */
export const ORG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Split a role value into its parts.
 *
 * Better Auth stores multiple roles as a comma separated string, so a value
 * such as `owner,admin` still has to be understood even though the UI only
 * assigns one role at a time.
 */
export function parseRoleList(role: string | readonly string[]): string[] {
	const values = typeof role === "string" ? [role] : role;

	return values
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter(Boolean);
}

/** True when the role string contains owner or admin. */
export function canEditOrganization(role: string): boolean {
	return parseRoleList(role).some((value) =>
		(ORG_SETTINGS_ROLES as readonly string[]).includes(value),
	);
}

/** True when the role is the organization's owner. */
export function isOrganizationOwner(role: string): boolean {
	return parseRoleList(role).includes("owner");
}

/**
 * Reject any role outside the three Handoff roles.
 *
 * Why this has to be explicit: the organization plugin accepts any role name
 * passed to invites and member updates. This is the allowlist that keeps a
 * caller from storing a role the UI and permission map do not understand.
 */
export function assertAllowedRoles(role: string | readonly string[]): void {
	const roles = parseRoleList(role);
	const unknown = roles.filter(
		(value) => !(ORG_ROLES as readonly string[]).includes(value),
	);

	if (unknown.length > 0) {
		throw new APIError("BAD_REQUEST", {
			message: `Unknown role: ${unknown.join(", ")}. Allowed roles are ${ORG_ROLES.join(", ")}.`,
		});
	}
}

/**
 * Validate and normalise an organization slug.
 *
 * Better Auth only enforces a minimum length and uniqueness, so this adds the
 * format, length and reserved word rules that the web router needs.
 */
export function validateOrganizationSlug(slug: string): string {
	// Reject surrounding whitespace instead of trimming it. Better Auth checks
	// uniqueness before this hook runs, so silently changing the value here
	// could pass the check for one slug and store a different, conflicting one.
	if (slug !== slug.trim()) {
		throw new APIError("BAD_REQUEST", {
			message: "The slug cannot start or end with a space.",
		});
	}

	const value = slug;

	if (value.length < 3 || value.length > 48) {
		throw new APIError("BAD_REQUEST", {
			message: "The slug must be between 3 and 48 characters long.",
		});
	}

	if (!ORG_SLUG_PATTERN.test(value)) {
		throw new APIError("BAD_REQUEST", {
			message:
				"The slug can only contain lowercase letters, numbers and single hyphens.",
		});
	}

	if (RESERVED_ORG_SLUGS.has(value)) {
		throw new APIError("BAD_REQUEST", {
			message: `The slug "${value}" is reserved. Choose a different one.`,
		});
	}

	return value;
}

/** True when the role may invite, remove and re-role other members. */
export function canManageMembers(role: string): boolean {
	return canEditOrganization(role);
}

/** True when the role may manage owners and other admins. */
export function canManageOwners(role: string): boolean {
	return isOrganizationOwner(role);
}

/**
 * True when the actor is allowed to modify the target member at all.
 *
 * Product rule: an admin manages members only. Owners and admins are read only
 * to an admin, which stops two admins from removing each other. The owner has
 * no such restriction.
 */
export function canManageTarget(
	actorRole: string,
	targetRole: string,
): boolean {
	if (canManageOwners(actorRole)) return true;

	return parseRoleList(targetRole).every((value) => value === "member");
}

/**
 * Roles an actor may hand out through an invitation.
 *
 * Owner is deliberately absent. Ownership is transferred by promoting an
 * existing member from the members page, which requires an explicit
 * confirmation, not by email invitation.
 */
export function assignableInvitationRoles(actorRole: string): OrgRole[] {
	return canManageOwners(actorRole) ? ["member", "admin"] : ["member"];
}

/** Trim a display name, rejecting an empty result. */
export function validateOrganizationName(name: string): string {
	const value = name.trim();

	if (value.length < 1 || value.length > 64) {
		throw new APIError("BAD_REQUEST", {
			message: "The organization name must be between 1 and 64 characters.",
		});
	}

	return value;
}
