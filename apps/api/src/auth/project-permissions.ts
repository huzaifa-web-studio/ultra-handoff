/**
 * Project role and permission rules.
 *
 * Why a separate module: project permissions are checked in the service, in
 * the routes that need a fast rejection, and mirrored in the browser for
 * hiding controls. One module keeps the server rules identical everywhere.
 *
 * The browser copy in apps/web is cosmetic only. This module is authoritative
 * and every write runs through it.
 *
 * Used by: src/services/project.service.ts, src/routes/projects.ts and the
 * organization owner promotion hook.
 */

import { APIError } from "better-auth/api";
import { isOrganizationOwner, parseRoleList } from "./permissions";

/** The only roles a project member can hold. */
export const PROJECT_ROLES = ["owner", "admin", "member", "client"] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Human readable labels for the role select and chips. */
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
	owner: "Owner",
	admin: "Admin",
	member: "Member",
	client: "Client",
};

export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 300;
export const PROJECT_SLUG_MIN = 3;
export const PROJECT_SLUG_MAX = 48;

/** Matches the slug shape the router and project URLs expect. */
export const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Slugs that would read as a control route once projects get a detail page.
 *
 * The list lives at `/<org>/projects`, so a project slug only matters for a
 * future `/<org>/projects/<slug>` route. Reserving the obvious control words
 * now avoids a rename later.
 */
export const RESERVED_PROJECT_SLUGS: ReadonlySet<string> = new Set([
	"new",
	"settings",
	"archive",
	"archived",
]);

/** True when a value is one of the four project roles. */
export function isProjectRole(value: string): value is ProjectRole {
	return (PROJECT_ROLES as readonly string[]).includes(value);
}

/** Reject any role outside the allowlist. */
export function assertProjectRole(value: string): ProjectRole {
	if (!isProjectRole(value)) {
		throw new APIError("BAD_REQUEST", {
			message: `Unknown project role: ${value}`,
		});
	}

	return value;
}

/** Label for a role, falling back to the raw value. */
export function projectRoleLabel(role: string): string {
	return PROJECT_ROLE_LABELS[role as ProjectRole] ?? role;
}

/**
 * Validate and normalise a project name.
 *
 * Trims because a surrounding space is invisible in the UI and is never what
 * the user meant. Rejects an empty result.
 */
export function validateProjectName(name: string): string {
	const value = name.trim();

	if (value.length < 1 || value.length > PROJECT_NAME_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: `The project name must be between 1 and ${PROJECT_NAME_MAX} characters.`,
		});
	}

	return value;
}

/**
 * Validate and normalise an optional project description.
 *
 * Trims and turns an empty value into null, so "no description" has one
 * representation in the database. The limit matches the form copy.
 */
export function validateProjectDescription(
	description: string | null | undefined,
): string | null {
	if (description == null) return null;

	const value = description.trim();

	if (value.length === 0) return null;

	if (value.length > PROJECT_DESCRIPTION_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: `The description must be ${PROJECT_DESCRIPTION_MAX} characters or fewer.`,
		});
	}

	return value;
}

/**
 * Validate and normalise a project slug.
 *
 * Whitespace is rejected rather than trimmed: silently changing a value after
 * a uniqueness check could store something the user did not see. The UI trims
 * before it sends, so this only catches a direct API call.
 */
export function validateProjectSlug(slug: string): string {
	if (slug !== slug.trim()) {
		throw new APIError("BAD_REQUEST", {
			message: "The slug cannot start or end with a space.",
		});
	}

	if (slug.length < PROJECT_SLUG_MIN || slug.length > PROJECT_SLUG_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: `The slug must be between ${PROJECT_SLUG_MIN} and ${PROJECT_SLUG_MAX} characters long.`,
		});
	}

	if (!PROJECT_SLUG_PATTERN.test(slug)) {
		throw new APIError("BAD_REQUEST", {
			message:
				"The slug can only contain lowercase letters, numbers and single hyphens.",
		});
	}

	if (RESERVED_PROJECT_SLUGS.has(slug)) {
		throw new APIError("BAD_REQUEST", {
			message: `The slug "${slug}" is reserved. Choose a different one.`,
		});
	}

	return slug;
}

/** True when the organization role may create projects. */
export function canCreateProject(organizationRole: string): boolean {
	return parseRoleList(organizationRole).some(
		(role) => role === "owner" || role === "admin",
	);
}

/**
 * The role that actually applies to a project.
 *
 * Organization owners are always project owners, even if the materialized
 * membership row is missing (for example after a failed sync). This is the
 * safety net that keeps an owner from being locked out of their own workspace.
 */
export function effectiveProjectRole(
	organizationRole: string,
	projectRole: string | null | undefined,
): ProjectRole | null {
	if (isOrganizationOwner(organizationRole)) return "owner";

	return projectRole && isProjectRole(projectRole) ? projectRole : null;
}

/** True when the project may be edited (name, slug, logo). */
export function canEditProject(
	organizationRole: string,
	projectRole: string | null | undefined,
): boolean {
	const role = effectiveProjectRole(organizationRole, projectRole);

	return role === "owner" || role === "admin";
}

/** True when the project may be permanently deleted. Owner only. */
export function canDeleteProject(
	organizationRole: string,
	projectRole: string | null | undefined,
): boolean {
	return effectiveProjectRole(organizationRole, projectRole) === "owner";
}

/** True when project members may be added, removed or re-roled. */
export function canManageProjectMembers(
	organizationRole: string,
	projectRole: string | null | undefined,
): boolean {
	return canEditProject(organizationRole, projectRole);
}

/**
 * True when that project role may still see an archived project.
 *
 * Archiving is a lifecycle change, not a permission change, so the rule is:
 * owners and admins keep the project because they need it to restore or delete
 * it, a client keeps it only when the project opted in, and a plain member
 * never sees it. Organization owners are handled by `effectiveProjectRole`
 * before this runs, so they always arrive here as `owner`.
 */
export function canViewArchivedProject(
	projectRole: ProjectRole,
	archiveVisibleToClient: boolean,
): boolean {
	if (projectRole === "owner" || projectRole === "admin") return true;

	if (projectRole === "client") return archiveVisibleToClient;

	return false;
}

/** Message shown whenever a write is attempted on an archived project. */
export const PROJECT_ARCHIVED_MESSAGE =
	"This project is archived. Restore it before making changes.";

/**
 * Reject a write on an archived project.
 *
 * Why a shared guard: the archive lock is a lifecycle rule, not a per route
 * rule. Every mutation calls it so a new endpoint cannot accidentally keep an
 * archived project editable.
 *
 * Returns 400 because Better Auth has no CONFLICT status, and the bulk runners
 * already treat 400 as "skipped", which is the right outcome for a locked row.
 */
export function assertProjectActive(archivedAt: Date | null): void {
	if (!archivedAt) return;

	throw new APIError("BAD_REQUEST", { message: PROJECT_ARCHIVED_MESSAGE });
}

/**
 * True when the actor may change or remove the target project member.
 *
 * Mirrors the organization rule: a project owner manages everyone, a project
 * admin manages members and clients only. This stops two admins from removing
 * each other.
 *
 * The actor check is part of the predicate so a caller that forgets the
 * manager check first cannot act on a member's or client's behalf.
 */
export function canManageProjectTarget(
	actorRole: ProjectRole,
	targetRole: string,
): boolean {
	if (actorRole !== "owner" && actorRole !== "admin") return false;

	if (actorRole === "owner") return true;

	return targetRole === "member" || targetRole === "client";
}

/** Roles an actor may assign through the member dialog. */
export function assignableProjectRoles(actorRole: ProjectRole): ProjectRole[] {
	return actorRole === "owner"
		? ["owner", "admin", "member", "client"]
		: ["member", "client"];
}

/** True when the actor may hand out that role. */
export function canAssignProjectRole(
	actorRole: ProjectRole,
	role: ProjectRole,
): boolean {
	return assignableProjectRoles(actorRole).includes(role);
}
