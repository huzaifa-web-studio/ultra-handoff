/**
 * Project overview route.
 *
 * Why this file is thin: the router only resolves the two params. The overview
 * content lives in features/projects/project-overview.tsx.
 *
 * Used by: the project workspace layout.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectOverview } from "#/features/projects/project-overview";

export const Route = createFileRoute("/_app/$orgSlug/projects/$projectSlug/")({
	component: ProjectOverviewRoute,
});

function ProjectOverviewRoute() {
	const { orgSlug, projectSlug } = Route.useParams();

	return <ProjectOverview orgSlug={orgSlug} projectSlug={projectSlug} />;
}
