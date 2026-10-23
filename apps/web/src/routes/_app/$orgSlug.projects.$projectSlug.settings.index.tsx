/**
 * Project general settings route.
 *
 * Why this file is thin: the page content lives in
 * features/projects/settings/project-general-page.tsx.
 *
 * Used by: the project settings layout.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectGeneralPage } from "#/features/projects/settings/project-general-page";

export const Route = createFileRoute(
	"/_app/$orgSlug/projects/$projectSlug/settings/",
)({
	component: ProjectGeneralRoute,
	staticData: { breadcrumb: "General" },
});

function ProjectGeneralRoute() {
	const { orgSlug, projectSlug } = Route.useParams();

	return <ProjectGeneralPage orgSlug={orgSlug} projectSlug={projectSlug} />;
}
