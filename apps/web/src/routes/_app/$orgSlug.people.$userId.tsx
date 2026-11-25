/**
 * Member profile route.
 *
 * Why a page instead of a dialog: a profile benefits from a real URL (sharing,
 * refresh, browser back) and from the full width for projects and assigned
 * work. The route lives under `people` so the `settings/members` management
 * screen keeps its own path.
 *
 * Used by: every avatar link and the member hover card.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProfilePage } from "#/features/people/profile-page";

export const Route = createFileRoute("/_app/$orgSlug/people/$userId")({
	component: ProfileRoute,
	staticData: { breadcrumb: "Profile" },
});

function ProfileRoute() {
	const { orgSlug, userId } = Route.useParams();

	return <ProfilePage orgSlug={orgSlug} userId={userId} />;
}
