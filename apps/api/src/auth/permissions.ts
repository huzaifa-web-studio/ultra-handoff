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
