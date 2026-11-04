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

import type { MilestoneTabKey } from "#/features/milestones/milestone-detail-panel";
import {
	MilestonePage,
	type MilestoneSelectionHandler,
} from "#/features/milestones/milestone-page";

/** Search params this route understands. Anything else is dropped. */
type MilestoneSearch = {
	milestone?: string;
	/**
	 * The detail tab. Only the non default value is stored, so an ordinary
	 * milestone link stays short.
	 */
	milestoneTab?: Extract<MilestoneTabKey, "comments">;
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
		milestoneTab: search.milestoneTab === "comments" ? "comments" : undefined,
	}),
	component: MilestonesRoute,
	staticData: { breadcrumb: "Milestones" },
});

function MilestonesRoute() {
	const { orgSlug, projectSlug } = Route.useParams();
	const { milestone, milestoneTab } = Route.useSearch();
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

	/**
	 * Write the active detail tab into the URL.
	 *
	 * `replace` is deliberate: changing tabs is not navigation, so the back
	 * button should still close the detail or leave the page. Keeping the tab in
	 * the URL means it survives a milestone switch, a refresh and a deep link.
	 */
	const setMilestoneTab = useCallback(
		(tab: MilestoneTabKey) => {
			void navigate({
				to: "/$orgSlug/projects/$projectSlug/milestones",
				params: { orgSlug, projectSlug },
				search: (previous) => ({
					...previous,
					milestoneTab: tab === "comments" ? "comments" : undefined,
				}),
				replace: true,
			});
		},
		[navigate, orgSlug, projectSlug],
	);

	return (
		<MilestonePage
			orgSlug={orgSlug}
			projectSlug={projectSlug}
			selectedId={milestone ?? null}
			selectedTab={milestoneTab ?? "overview"}
			onSelect={setMilestone}
			onTabChange={setMilestoneTab}
		/>
	);
}
