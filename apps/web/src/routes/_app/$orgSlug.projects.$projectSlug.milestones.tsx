/**
 * Project milestones route.
 *
 * Why this file is thin: the tab content lives in
 * features/projects/project-milestones-tab.tsx.
 *
 * Used by: the project workspace layout.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectMilestonesTab } from "#/features/projects/project-milestones-tab";

export const Route = createFileRoute(
	"/_app/$orgSlug/projects/$projectSlug/milestones",
)({
	component: ProjectMilestonesTab,
	staticData: { breadcrumb: "Milestones" },
});
