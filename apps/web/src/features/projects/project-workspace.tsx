/**
 * Project workspace shell.
 *
 * Why this is a feature component: the route file only resolves the two params.
 * Everything a project tab shares (data, breadcrumb label, pin action, identity
 * header and tab bar) lives here, and the tab itself renders through the
 * Outlet.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.tsx.
 */

import { Outlet, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { setProjectBreadcrumbLabel } from "#/components/app-sidebar/project-breadcrumb";
import { RealtimeProvider } from "#/features/realtime/provider";
import {
	useProjectDetailBySlug,
	useSetProjectPinned,
	useUnarchiveProject,
} from "./hooks";
import { ProjectErrorState } from "./project-error-state";
import { ProjectTabs } from "./project-tabs";
import { ProjectWorkspaceHeader } from "./project-workspace-header";
import { ProjectWorkspaceSkeleton } from "./project-workspace-skeleton";

/**
 * localStorage key for the collapsed details preference.
 *
 * The tab bar owns the toggle, but the header it hides lives in this layout, so
 * the preference is stored here and survives both tab navigation and a reload.
 */
const DETAILS_COLLAPSED_KEY = "handoff:project-details-collapsed";

/**
 * Read the stored preference.
 *
 * Storage throws when the browser blocks it (private mode, a strict cookie
 * policy), so a failure simply means the details start expanded.
 */
function readDetailsCollapsed(): boolean {
	// The app renders on the client, but the shell is prerendered at build time,
	// so guard against a missing window instead of assuming one.
	if (typeof window === "undefined") return false;

	try {
		return window.localStorage.getItem(DETAILS_COLLAPSED_KEY) === "true";
	} catch {
		return false;
	}
}

export function ProjectWorkspace({
	orgSlug,
	projectSlug,
}: {
	orgSlug: string;
	projectSlug: string;
}) {
	const query = useProjectDetailBySlug(orgSlug, projectSlug);
	const { mutate: setPinned, isPending: isPinning } =
		useSetProjectPinned(orgSlug);
	const { mutate: unarchive, isPending: isRestoring } =
		useUnarchiveProject(orgSlug);
	const { pathname } = useLocation();
	const [detailsCollapsed, setDetailsCollapsed] =
		useState(readDetailsCollapsed);

	const project = query.data?.project;

	// Persist the preference. Writing is best effort for the same reason reading
	// is: the toggle must keep working even when storage is unavailable.
	useEffect(() => {
		try {
			window.localStorage.setItem(
				DETAILS_COLLAPSED_KEY,
				String(detailsCollapsed),
			);
		} catch {
			// The preference is a convenience, not state the page depends on.
		}
	}, [detailsCollapsed]);

	function handleToggleDetails() {
		setDetailsCollapsed((collapsed) => !collapsed);
	}

	/*
	 * The milestones tab is a master detail surface that fills the viewport and
	 * scrolls its own panes. Every other tab is a normal document that scrolls
	 * inside this column.
	 */
	const fillsViewport = pathname.endsWith("/milestones");

	// The header renders its breadcrumb from static route data, so the real
	// project name is published here while any tab is mounted.
	useEffect(() => {
		setProjectBreadcrumbLabel(project?.name ?? null);

		return () => setProjectBreadcrumbLabel(null);
	}, [project?.name]);

	if (query.isPending) {
		return <ProjectWorkspaceSkeleton />;
	}

	if (query.isError && !query.data) {
		return (
			<ProjectErrorState
				message={
					query.error instanceof Error
						? query.error.message
						: "Could not load the project."
				}
				onRetry={() => {
					void query.refetch();
				}}
				orgSlug={orgSlug}
			/>
		);
	}

	if (!query.data || !project) return null;

	const { members } = query.data;
	const archived = project.status === "archived";

	function handleTogglePin() {
		if (!project) return;

		setPinned(
			{ projectId: project.id, pinned: !project.pinned },
			{
				onSuccess: () => {
					toast.success(
						project.pinned
							? "Removed from your sidebar."
							: "Pinned to your sidebar.",
					);
				},
				onError: (error) => {
					toast.error(
						error instanceof Error
							? error.message
							: "Could not update the pin.",
					);
				},
			},
		);
	}

	function handleRestore() {
		if (!project) return;

		unarchive(project.id, {
			onSuccess: () => {
				toast.success(`${project.name} was restored.`);
			},
			onError: (error) => {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not restore the project.",
				);
			},
		});
	}

	return (
		/*
		 * Full height column.
		 *
		 * The shell content area already carries the page gutter (`p-8`), so
		 * `h-full` resolves to the visible content box and the column fits it
		 * exactly. The old `h-[calc(100%+4rem)]` plus `-mt-8` overshot by the
		 * parent's bottom padding, which made the whole page scrollable by 32px
		 * even when nothing was hidden below the fold.
		 *
		 * `-mx-8` spreads an auto width block to the full width without needing
		 * a second calc, and gives the milestone split its full bleed.
		 */
		<div className="-mx-8 flex h-full min-h-0 flex-col">
			{/*
			 * Collapsible identity block.
			 *
			 * `grid-template-rows: 1fr -> 0fr` animates from the header's real
			 * height, so a long description or the archived banner collapses
			 * smoothly and the tab content below gains the space on the same
			 * frame. `inert` keeps the hidden pin and restore controls out of the
			 * tab order while the row is closed.
			 */}
			<div
				id="project-details"
				className={cn(
					"grid shrink-0 transition-[grid-template-rows] duration-300 ease-out",
					detailsCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden" inert={detailsCollapsed}>
					<div className="px-8 pb-6">
						<ProjectWorkspaceHeader
							orgSlug={orgSlug}
							project={project}
							members={members}
							archived={archived}
							isPinning={isPinning}
							onTogglePin={handleTogglePin}
							canRestore={query.data.viewer.canEdit}
							isRestoring={isRestoring}
							onRestore={handleRestore}
						/>
					</div>
				</div>
			</div>
			<ProjectTabs
				orgSlug={orgSlug}
				projectSlug={projectSlug}
				detailsCollapsed={detailsCollapsed}
				onToggleDetails={handleToggleDetails}
			/>
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col px-8 pt-6 pb-8",
					!fillsViewport && "overflow-y-auto",
				)}
			>
				{/*
				 * The stream is project scoped, and every tab that needs it renders
				 * inside this Outlet. Mounting here keeps the connection tied to the
				 * project view instead of the whole app shell.
				 */}
				<RealtimeProvider orgSlug={orgSlug} projectId={project.id}>
					<Outlet />
				</RealtimeProvider>
			</div>
		</div>
	);
}
