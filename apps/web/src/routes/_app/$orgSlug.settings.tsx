/**
 * Organization settings layout.
 *
 * Why a layout: settings now has three screens (General, Members,
 * Invitations). This route supplies the shared "Settings" breadcrumb and the
 * `<Outlet />`, so nested pages read `Acme > Settings > Members` instead of
 * replacing the settings page.
 *
 * Used by: the `_app` layout and every page under `/$orgSlug/settings`.
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/settings")({
	component: SettingsLayout,
	staticData: { breadcrumb: "Settings" },
});

function SettingsLayout() {
	return <Outlet />;
}
