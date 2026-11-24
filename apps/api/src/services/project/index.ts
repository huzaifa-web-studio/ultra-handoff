/**
 * Public surface of the project module.
 *
 * Why: routes and sibling services should import one entry point instead of
 * reaching into individual files. That keeps the internal layout free to move
 * and matches the folder modules used by storage, realtime, queues and
 * milestones.
 *
 * Every name the old `project.service.ts` exported is re-exported here,
 * including the `loadUserMap` pass through, so callers only change their import
 * path.
 *
 * Used by: `routes/projects.ts`, `services/member.service.ts`,
 * `services/milestone/`, the notification services and the realtime gateway.
 */

export { loadUserMap } from "../user.service";
export { loadProjectAccess, projectVisibility } from "./access";
export {
	bulkAddProjectMembers,
	bulkRemoveProjectMembers,
} from "./bulk-members";
export {
	bulkDeleteProjects,
	bulkSetProjectsArchived,
} from "./bulk-projects";
export { deleteProject } from "./delete";
export type { UserProfile } from "./detail";
export {
	getProjectDetail,
	getProjectDetailBySlug,
	searchUserProfiles,
} from "./detail";
export {
	createProject,
	setProjectArchived,
	setProjectArchiveVisibility,
	updateProject,
} from "./lifecycle";
export {
	getSidebarProjects,
	listProjects,
	PINNED_PROJECT_LIMIT,
	setProjectPinned,
} from "./list";
export {
	addProjectMember,
	removeProjectMember,
	updateProjectMemberRole,
} from "./members";
export { syncOrganizationOwnerToProjects } from "./owners";
export type {
	CreateProjectInput,
	ProjectAccess,
	ProjectDetail,
	ProjectListQuery,
	ProjectListResult,
	ProjectMemberRow,
	ProjectRow,
	ProjectSort,
	ProjectStatus,
	ProjectSummary,
	ProjectViewer,
	SidebarProjectsResult,
	UpdateProjectInput,
} from "./types";
