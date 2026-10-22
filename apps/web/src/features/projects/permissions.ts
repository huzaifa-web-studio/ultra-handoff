/**
 * Project role helpers for the web app.
 *
 * Why a small local map: the browser needs the role names to render selects and
 * to hide controls the caller cannot use. It never enforces anything. The API
 * checks every write again with the same rules.
 *
 * Capabilities that apply to the caller as a whole (canEdit, canDelete,
 * canManageMembers, assignableRoles) come from the API response. Only the per
 * target check lives here, because the API sends the viewer's role and each
 * row's role rather than a matrix.
 *
 * Used by: the projects feature components.
 */

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

/** True when a value is one of the four project roles. */
export function isProjectRole(
	value: string | null | undefined,
): value is ProjectRole {
	return value != null && (PROJECT_ROLES as readonly string[]).includes(value);
}

/** Label for a role, falling back to the raw value. */
export function projectRoleLabel(role: string): string {
	return PROJECT_ROLE_LABELS[role as ProjectRole] ?? role;
}

/**
 * True when the actor may change or remove that project member.
 *
 * Mirrors the API: an owner manages everyone, an admin manages members and
 * clients only. Organization owner rows are locked separately.
 */
export function canManageProjectTarget(
	actorRole: string | null | undefined,
	targetRole: string,
): boolean {
	if (actorRole === "owner") return true;

	return targetRole === "member" || targetRole === "client";
}
