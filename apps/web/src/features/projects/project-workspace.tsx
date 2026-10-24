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
import { useEffect } from "react";
import { toast } from "sonner";

import { setProjectBreadcrumbLabel } from "#/components/app-sidebar/project-breadcrumb";
import {
	useProjectDetailBySlug,
	useSetProjectPinned,
	useUnarchiveProject,
} from "./hooks";
import { ProjectErrorState } from "./project-error-state";
import { ProjectTabs } from "./project-tabs";
import { ProjectWorkspaceHeader } from "./project-workspace-header";
import { ProjectWorkspaceSkeleton } from "./project-workspace-skeleton";

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

	const project = query.data?.project;

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
		 * Fixed height column.
		 *
		 * `h-[calc(100%+4rem)]` cancels the shell padding exactly: the parent
		 * scroll container has `p-8` (2rem on each side), so the content box is
		 * 4rem shorter than the visible area. Growing by 4rem and pulling up by
		 * 2rem makes this column fill the viewport, which is what gives the
		 * milestone split panes a real height to resolve `h-full` against.
		 *
		 * `-mx-8` spreads an auto width block to the full width without needing
		 * a second calc.
		 */
		<div className="-mx-8 -mt-8 flex h-[calc(100%+4rem)] min-h-0 flex-col">
			<div className="shrink-0 px-8 pt-8 pb-6">
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
			<ProjectTabs orgSlug={orgSlug} projectSlug={projectSlug} />
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col px-8 pt-6 pb-8",
					!fillsViewport && "overflow-y-auto",
				)}
			>
				<Outlet />
			</div>
		</div>
	);
}
