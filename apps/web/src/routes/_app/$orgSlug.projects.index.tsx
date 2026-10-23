/**
 * Projects route.
 *
 * Why this file is thin: the router only resolves the workspace slug here. The
 * page state and UI live in features/projects/projects-page.tsx.
 *
 * Used by: the app router at `/$orgSlug/projects`.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectsPage } from "#/features/projects/projects-page";

export const Route = createFileRoute("/_app/$orgSlug/projects/")({
	component: ProjectsRoute,
});

function ProjectsRoute() {
	const { orgSlug } = Route.useParams();

	return <ProjectsPage orgSlug={orgSlug} />;
}
