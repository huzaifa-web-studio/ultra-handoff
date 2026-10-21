/**
 * Organization dashboard.
 *
 * Why a separate index route: `$orgSlug.tsx` is now the layout that renders
 * the organization's child routes (settings today, members and projects
 * later). The dashboard itself lives at the index so the layout can own the
 * `<Outlet />` without also rendering dashboard content on nested pages.
 *
 * Used by: the `_app` layout at `/$orgSlug`.
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/")({
	component: DashboardPage,
});

function DashboardPage() {
	return (
		<div>
			<h1 className="text-2xl font-bold text-app-text">Dashboard</h1>
			<p className="mt-2 text-app-text-muted">Welcome to your workspace.</p>
		</div>
	);
}
