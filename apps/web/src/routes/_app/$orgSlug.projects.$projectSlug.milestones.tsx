/**
 * Project milestones route.
 *
 * Why this file stays thin: it owns the URL contract (`?milestone=`) and
 * nothing else. All behaviour lives in features/milestones/milestone-page.tsx.
 *
 * The selected milestone is a search parameter rather than a path segment so
 * the list stays mounted while the detail changes. That keeps filter state,
 * scroll position and the mobile sheet's back button behaviour intact.
 *
 * Used by: the project workspace layout.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import {
	MilestonePage,
	type MilestoneSelectionHandler,
} from "#/features/milestones/milestone-page";

/** Search params this route understands. Anything else is dropped. */
type MilestoneSearch = {
	milestone?: string;
};

export const Route = createFileRoute(
	"/_app/$orgSlug/projects/$projectSlug/milestones",
)({
	// Validate instead of trusting the URL: a hand edited or stale link can
	// carry anything, and the detail fetch should only receive a plausible id.
	validateSearch: (search: Record<string, unknown>): MilestoneSearch => ({
		milestone:
			typeof search.milestone === "string" && search.milestone.length > 0
				? search.milestone
				: undefined,
	}),
	component: MilestonesRoute,
	staticData: { breadcrumb: "Milestones" },
});

function MilestonesRoute() {
	const { orgSlug, projectSlug } = Route.useParams();
	const { milestone } = Route.useSearch();
	const navigate = useNavigate();

	/**
	 * Write the selection into the URL.
	 *
	 * `replace` is used on a wide screen where selecting a row is browsing, not
	 * navigating, so the back button is not flooded with one entry per row. On a
	 * narrow screen the selection opens a sheet, so it pushes and the back
	 * button closes it.
	 */
	const setMilestone = useCallback<MilestoneSelectionHandler>(
		(id, options) => {
			void navigate({
				to: "/$orgSlug/projects/$projectSlug/milestones",
				params: { orgSlug, projectSlug },
				search: (previous) => ({
					...previous,
					milestone: id ?? undefined,
				}),
				replace: options?.replace ?? false,
			});
		},
		[navigate, orgSlug, projectSlug],
	);

	return (
		<MilestonePage
			orgSlug={orgSlug}
			projectSlug={projectSlug}
			selectedId={milestone ?? null}
			onSelect={setMilestone}
		/>
	);
}
