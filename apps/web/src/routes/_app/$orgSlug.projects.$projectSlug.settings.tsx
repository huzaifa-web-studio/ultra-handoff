/**
 * Project settings route.
 *
 * Why this file is thin: the router resolves the params, and the layout with the
 * internal General/Members navigation lives in
 * features/projects/settings/project-settings-layout.tsx.
 *
 * Used by: the project workspace layout.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectSettingsLayout } from "#/features/projects/settings/project-settings-layout";

export const Route = createFileRoute(
	"/_app/$orgSlug/projects/$projectSlug/settings",
)({
	component: ProjectSettingsRoute,
	staticData: { breadcrumb: "Settings" },
});

function ProjectSettingsRoute() {
	const { orgSlug, projectSlug } = Route.useParams();

	return <ProjectSettingsLayout orgSlug={orgSlug} projectSlug={projectSlug} />;
}
