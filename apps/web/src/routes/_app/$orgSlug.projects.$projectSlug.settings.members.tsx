/**
 * Project members settings route.
 *
 * Why this file is thin: the page content lives in
 * features/projects/settings/project-members-page.tsx.
 *
 * Used by: the project settings layout.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectMembersPage } from "#/features/projects/settings/project-members-page";

export const Route = createFileRoute(
	"/_app/$orgSlug/projects/$projectSlug/settings/members",
)({
	component: ProjectMembersRoute,
	staticData: { breadcrumb: "Members" },
});

function ProjectMembersRoute() {
	const { orgSlug, projectSlug } = Route.useParams();

	return <ProjectMembersPage orgSlug={orgSlug} projectSlug={projectSlug} />;
}
