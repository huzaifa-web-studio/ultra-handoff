/**
 * Project row mapping.
 *
 * Why this file: the list, the detail pane and every mutation response build
 * the same project row. Mapping it once keeps those surfaces identical and
 * keeps the display-name logic in one place.
 *
 * Used by: `list.ts`, `detail.ts`, `access.ts` and the write modules.
 */

import { APIError } from "better-auth/api";
import {
	assignableProjectRoles,
	canDeleteProject,
	canEditProject,
	canManageProjectMembers,
	canViewArchivedProject,
	effectiveProjectRole,
} from "../../auth/project-permissions";
import { keyFromFileUrl } from "../../lib/storage";
import type { TenantContext } from "../../middleware/tenant";
import type {
	ProjectAccess,
	ProjectRow,
	ProjectSummary,
	ProjectViewer,
} from "./types";

/** Reject anything that is not an object this API produced. */
export function normalizeLogo(
	logo: string | null | undefined,
	organizationId: string,
): string | null {
	if (logo == null) return null;

	const value = logo.trim();

	if (value.length === 0) return null;

	if (value.length > 500) {
		throw new APIError("BAD_REQUEST", { message: "The logo URL is too long." });
	}

	const key = keyFromFileUrl(value);

	// Only objects this organization uploaded for a project may be attached.
	// That keeps an arbitrary external URL out of the project logo field.
	if (!key || key.includes("..") || key.includes("//")) {
		throw new APIError("BAD_REQUEST", {
			message: "The project logo must be an uploaded image.",
		});
	}

	if (!key.startsWith(`organizations/${organizationId}/projects/`)) {
		throw new APIError("BAD_REQUEST", {
			message: "The project logo does not belong to this organization.",
		});
	}

	return value;
}

/** Map a database row plus the caller's effective role into the wire shape. */
export function toProjectRow(
	row: ProjectAccess["row"],
	tenant: TenantContext,
): ProjectRow {
	const role = effectiveProjectRole(tenant.role, row.myRole) ?? "member";

	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
		description: row.description,
		status: row.archivedAt ? "archived" : "active",
		myRole: role,
		memberCount: Number(row.memberCount ?? 0),
		canEdit: canEditProject(tenant.role, row.myRole),
		canDelete: canDeleteProject(tenant.role, row.myRole),
		archiveVisibleToClient: row.archiveVisibleToClient,
		pinned: Boolean(row.pinned),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
	};
}

/**
 * Build the viewer capabilities for one project.
 *
 * `canSeeArchived` is computed from the caller's effective role and the project
 * flag, so the UI never has to re-implement the archive visibility rule.
 *
 * `canManageMembers` is false while the project is archived, because every
 * member write is rejected in that state. `canEdit` stays role based so the
 * restore and delete controls remain reachable.
 */
export function toProjectViewer(
	tenant: TenantContext,
	access: ProjectAccess,
): ProjectViewer {
	const { row, role } = access;
	const archived = row.archivedAt !== null;

	return {
		organizationRole: tenant.role,
		projectRole: role,
		canEdit: canEditProject(tenant.role, role),
		canDelete: canDeleteProject(tenant.role, role),
		canManageMembers: !archived && canManageProjectMembers(tenant.role, role),
		canSeeArchived:
			!archived || canViewArchivedProject(role, row.archiveVisibleToClient),
		canEditArchiveVisibility: canEditProject(tenant.role, role),
		locked: archived,
		assignableRoles: assignableProjectRoles(role),
	};
}

/** Map an activity joined row into the sidebar summary shape. */
export function toProjectSummary(
	row: {
		id: string;
		name: string;
		slug: string;
		logo: string | null;
		archivedAt: Date | null;
		pinned?: boolean;
	},
	pinnedOverride?: boolean,
): ProjectSummary {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
		status: row.archivedAt ? "archived" : "active",
		pinned: pinnedOverride ?? Boolean(row.pinned),
	};
}
