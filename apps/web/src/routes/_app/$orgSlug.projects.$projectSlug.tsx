/**
 * Project workspace route.
 *
 * Why this file is thin: the router only resolves the two params. The shared
 * header, tab bar and data live in features/projects/project-workspace.tsx, and
 * each tab is a child route rendered through its Outlet.
 *
 * Used by: the app router at `/$orgSlug/projects/$projectSlug`.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectWorkspace } from "#/features/projects/project-workspace";

export const Route = createFileRoute("/_app/$orgSlug/projects/$projectSlug")({
	component: ProjectWorkspaceRoute,
	staticData: { breadcrumb: "Project" },
});

function ProjectWorkspaceRoute() {
	const { orgSlug, projectSlug } = Route.useParams();

	return <ProjectWorkspace orgSlug={orgSlug} projectSlug={projectSlug} />;
}
