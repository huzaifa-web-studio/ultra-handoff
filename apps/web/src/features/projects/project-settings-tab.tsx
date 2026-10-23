/**
 * Project settings tab.
 *
 * Why a placeholder for now: project level settings need their own space now
 * that the page is tabbed. Identity, members and archive controls will move
 * here.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.settings.tsx.
 */

import { ProjectTabPlaceholder } from "./project-tab-placeholder";

export function ProjectSettingsTab() {
	return (
		<ProjectTabPlaceholder
			title="Settings"
			description="Project details, members and archive controls will live here."
		/>
	);
}
