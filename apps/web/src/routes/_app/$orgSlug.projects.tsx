/**
 * Projects layout.
 *
 * Why a layout: the projects list and an individual project workspace both live
 * under `/$orgSlug/projects`. The layout supplies the shared "Projects"
 * breadcrumb and the `<Outlet />`, so a project reads as
 * "Acme > Projects > Project" instead of replacing the projects page.
 *
 * Used by: the `_app` layout and every page under `/$orgSlug/projects`.
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/projects")({
	component: ProjectsLayout,
	staticData: { breadcrumb: "Projects" },
});

function ProjectsLayout() {
	return <Outlet />;
}
