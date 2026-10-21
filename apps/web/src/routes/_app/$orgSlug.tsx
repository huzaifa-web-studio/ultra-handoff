/**
 * Organization layout route.
 *
 * Why a layout: every screen inside a workspace is nested under the slug
 * (`/$orgSlug`, `/$orgSlug/settings`). TanStack Router renders the matched
 * child through this route's `<Outlet />`, so without it a nested page like
 * settings would silently fall back to the dashboard.
 *
 * The "Dashboard" breadcrumb is deliberate: AppHeader replaces that label with
 * the active organization name, which gives nested pages a useful crumb such
 * as "Acme > Settings".
 *
 * Used by: the `_app` layout at `/$orgSlug` and every child route under it.
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug")({
	component: OrganizationLayout,
	staticData: { breadcrumb: "Dashboard" },
});

function OrganizationLayout() {
	return <Outlet />;
}
