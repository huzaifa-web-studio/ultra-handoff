/**
 * Project milestones tab.
 *
 * Why a placeholder for now: the tab and its URL exist, so the layout,
 * breadcrumb and navigation are settled. The milestone list and its approvals
 * come next.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.milestones.tsx.
 */

import { ProjectTabPlaceholder } from "./project-tab-placeholder";

export function ProjectMilestonesTab() {
	return (
		<ProjectTabPlaceholder
			title="Milestones"
			description="Milestone dates, status and client sign off will appear here."
		/>
	);
}
