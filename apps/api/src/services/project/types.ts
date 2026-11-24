/**
 * Project wire shapes.
 *
 * Why this file: the route layer and every project module name these shapes,
 * so they live together instead of being spread across the split.
 *
 * Used by: every module in `services/project/` and `routes/projects.ts`.
 */

import type { ProjectRole } from "../../auth/project-permissions";

/** Lifecycle state derived from `archived_at`. */
export type ProjectStatus = "active" | "archived";

/** Sortable columns. Anything else falls back to the newest first. */
export type ProjectSort = "name" | "createdAt" | "updatedAt";

/** One row the projects table renders. */
export type ProjectRow = {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	description: string | null;
	status: ProjectStatus;
	myRole: ProjectRole;
	memberCount: number;
	canEdit: boolean;
	canDelete: boolean;
	/** True when a client keeps seeing this project after it is archived. */
	archiveVisibleToClient: boolean;
	/** True when the caller pinned the project in their own sidebar. */
	pinned: boolean;
	createdAt: string;
	updatedAt: string;
	archivedAt: string | null;
};

/** Capabilities of the caller, so the UI never guesses from a role string. */
export type ProjectViewer = {
	organizationRole: string;
	projectRole: ProjectRole;
	canEdit: boolean;
	canDelete: boolean;
	canManageMembers: boolean;
	/** True when the caller can still see this project while it is archived. */
	canSeeArchived: boolean;
	/** True when the caller may change the archive visibility setting. */
	canEditArchiveVisibility: boolean;
	/** True when the project is archived and therefore read-only. */
	locked: boolean;
	assignableRoles: ProjectRole[];
};

/** One project member, with the person attached. */
export type ProjectMemberRow = {
	userId: string;
	memberId: string;
	name: string;
	email: string;
	image: string | null;
	role: ProjectRole;
	isSelf: boolean;
	isOrganizationOwner: boolean;
	addedAt: string;
};

/** Everything the list page needs in one request. */
export type ProjectListResult = {
	organizationId: string;
	projects: ProjectRow[];
	viewer: {
		organizationRole: string;
		canCreate: boolean;
		/** True when the caller can see at least one archived project. */
		canSeeArchived: boolean;
	};
	counts: { all: number; active: number; archived: number };
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
};

/** Everything the edit and members dialogs need in one request. */
export type ProjectDetail = {
	organizationId: string;
	project: ProjectRow;
	members: ProjectMemberRow[];
	viewer: ProjectViewer;
};

/**
 * The lightweight shape the sidebar renders.
 *
 * Deliberately smaller than `ProjectRow`: the sidebar needs an identity, a
 * label and an archived hint, not member counts or capability flags.
 */
export type ProjectSummary = {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	status: ProjectStatus;
	pinned: boolean;
};

/** Everything the sidebar needs in one request. */
export type SidebarProjectsResult = {
	pinned: ProjectSummary[];
};

/** Normalised list filters, parsed and clamped by the route. */
export type ProjectListQuery = {
	search: string;
	status: "all" | ProjectStatus;
	sort: ProjectSort;
	direction: "asc" | "desc";
	page: number;
	pageSize: number;
};

/** Public write inputs. */
export type CreateProjectInput = {
	name: string;
	slug: string;
	description?: string | null;
	logo?: string | null;
};

export type UpdateProjectInput = {
	name?: string;
	slug?: string;
	/** An empty string clears the description, undefined leaves it untouched. */
	description?: string;
	/** An empty string clears the logo, undefined leaves it untouched. */
	logo?: string;
};

/**
 * Project access plus the caller's effective role.
 *
 * Exported so the milestone service reuses the exact same visibility rule
 * instead of re-deriving it. A milestone must never be reachable through a
 * project the caller cannot see.
 */
export type ProjectAccess = {
	row: {
		id: string;
		name: string;
		slug: string;
		logo: string | null;
		description: string | null;
		archivedAt: Date | null;
		archiveVisibleToClient: boolean;
		createdAt: Date;
		updatedAt: Date;
		myRole: string | null;
		memberCount: number;
		pinned: boolean;
	};
	role: ProjectRole;
};
