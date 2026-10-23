/**
 * Project settings route.
 *
 * Why this file is thin: the tab content lives in
 * features/projects/project-settings-tab.tsx.
 *
 * Used by: the project workspace layout.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectSettingsTab } from "#/features/projects/project-settings-tab";

export const Route = createFileRoute(
	"/_app/$orgSlug/projects/$projectSlug/settings",
)({
	component: ProjectSettingsTab,
	staticData: { breadcrumb: "Settings" },
});
