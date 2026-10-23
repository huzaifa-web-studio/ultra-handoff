/**
 * Sidebar projects section.
 *
 * Why it exists: the projects page is the full workspace, but day to day people
 * work inside a handful of projects. This section keeps them one click away
 * without turning the sidebar into a second projects table.
 *
 * Structure:
 *   - "All projects" is the first row and links to the full page, where search,
 *     filters, create, archive and bulk actions live.
 *   - Pinned projects sit in their own sub section. A pin is per person and per
 *     workspace, persisted on the server, so it follows the user across devices.
 *   - Every other active project follows, alphabetically, in pages. The list
 *     asks for the next page as the sidebar scrolls, so a workspace with many
 *     projects stays fast.
 *
 * Any row can be pinned or unpinned. Pinning moves the row to the Pinned
 * section; unpinning returns it to the list.
 *
 * Used by: components/app-sidebar/app-sidebar.tsx.
 */

import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
} from "@org/ui/components/sidebar";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
	ChevronDownIcon,
	LayoutListIcon,
	Loader2Icon,
	PinIcon,
	RefreshCwIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { UserAvatar } from "#/components/user-avatar";
import type { ProjectSummary } from "#/features/projects/api";
import {
	useSetProjectPinned,
	useSidebarAllProjects,
	useSidebarProjects,
} from "#/features/projects/hooks";

export function NavProjects({ orgSlug }: { orgSlug: string }) {
	const navigate = useNavigate();
	const { pathname } = useLocation();

	const pinnedQuery = useSidebarProjects(orgSlug);
	const allQuery = useSidebarAllProjects(orgSlug);
	const pinMutation = useSetProjectPinned(orgSlug);

	const pinned = pinnedQuery.data?.pinned ?? [];
	const pinnedIds = new Set(pinned.map((project) => project.id));

	// Flatten the loaded pages. Pinned projects are removed here because they
	// already have a row in the Pinned section above.
	const allProjects =
		allQuery.data?.pages.flatMap((page) => page.projects) ?? [];
	const visibleProjects = allProjects.filter(
		(project) => !pinnedIds.has(project.id),
	);

	const isPending = allQuery.isPending;
	const loadMoreFailed = allQuery.isError && allProjects.length > 0;

	// The sentinel is the "Load more" row. When it scrolls into view inside the
	// sidebar, the next page starts loading. Clicking it does the same, which
	// keeps the control usable from the keyboard.
	const sentinelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const node = sentinelRef.current;

		// Do not auto retry after a failure: the row becomes a manual retry.
		if (!node || !allQuery.hasNextPage || allQuery.isError) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (
					entries.some((entry) => entry.isIntersecting) &&
					!allQuery.isFetchingNextPage
				) {
					void allQuery.fetchNextPage();
				}
			},
			{ rootMargin: "120px" },
		);

		observer.observe(node);
		return () => observer.disconnect();
	}, [
		allQuery.hasNextPage,
		allQuery.isFetchingNextPage,
		allQuery.isError,
		allQuery.fetchNextPage,
	]);

	/** Navigate without breaking open in a new tab. */
	function handleNavigate(event: React.MouseEvent, projectSlug: string) {
		if (
			event.metaKey ||
			event.ctrlKey ||
			event.shiftKey ||
			event.altKey ||
			event.button !== 0
		) {
			return;
		}

		event.preventDefault();
		navigate({
			to: "/$orgSlug/projects/$projectSlug",
			params: { orgSlug, projectSlug },
		});
	}

	/** Pin or unpin from the sidebar, with one failure message. */
	function handlePin(projectId: string, pinnedNow: boolean) {
		pinMutation.mutate(
			{ projectId, pinned: pinnedNow },
			{
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

	return (
		<SidebarGroup>
			<SidebarGroupLabel>Projects</SidebarGroupLabel>
			<SidebarMenu>
				{/*
				 * The full list is the first row, above the projects, so it keeps
				 * a fixed position as the section grows and is always one click
				 * away.
				 */}
				<SidebarMenuItem>
					<SidebarMenuButton
						href={`/${orgSlug}/projects`}
						isActive={pathname === `/${orgSlug}/projects`}
						aria-current={
							pathname === `/${orgSlug}/projects` ? "page" : undefined
						}
						tooltip="All projects"
						onClick={(event: React.MouseEvent) => {
							if (
								event.metaKey ||
								event.ctrlKey ||
								event.shiftKey ||
								event.altKey ||
								event.button !== 0
							) {
								return;
							}

							event.preventDefault();
							navigate({ to: "/$orgSlug/projects", params: { orgSlug } });
						}}
					>
						<LayoutListIcon aria-hidden />
						<span>All projects</span>
					</SidebarMenuButton>
				</SidebarMenuItem>

				{pinned.length > 0 && (
					<>
						{/* A sub label rather than a second group, so the section
						    stays one block in the sidebar. */}
						<div className="mt-2 px-3 text-xs font-semibold tracking-wider text-sidebar-foreground/70 uppercase group-data-[collapsible=icon]:hidden">
							Pinned
						</div>
						{pinned.map((project) => (
							<ProjectRowItem
								key={project.id}
								project={project}
								pinned
								orgSlug={orgSlug}
								pathname={pathname}
								isPinning={pinMutation.isPending}
								onNavigate={handleNavigate}
								onPin={handlePin}
							/>
						))}
					</>
				)}

				{isPending && (
					<>
						<SidebarMenuItem>
							<SidebarMenuSkeleton showIcon />
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuSkeleton showIcon />
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuSkeleton showIcon />
						</SidebarMenuItem>
					</>
				)}

				{visibleProjects.map((project) => (
					<ProjectRowItem
						key={project.id}
						project={project}
						pinned={false}
						orgSlug={orgSlug}
						pathname={pathname}
						isPinning={pinMutation.isPending}
						onNavigate={handleNavigate}
						onPin={handlePin}
					/>
				))}

				{/* The first page failed: offer a retry instead of an empty list. */}
				{allQuery.isError && allProjects.length === 0 && (
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Retry loading projects"
							onPress={() => {
								void allQuery.refetch();
							}}
						>
							<RefreshCwIcon aria-hidden />
							<span>Could not load projects</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				)}

				{!isPending &&
					!allQuery.isError &&
					allProjects.length === 0 &&
					pinned.length === 0 && (
						<SidebarMenuItem>
							<div className="px-3 py-2 text-xs text-sidebar-foreground/60">
								No projects yet
							</div>
						</SidebarMenuItem>
					)}

				{allQuery.hasNextPage && (
					<SidebarMenuItem>
						<div ref={sentinelRef}>
							<SidebarMenuButton
								tooltip={
									allQuery.isFetchingNextPage
										? "Loading more projects"
										: loadMoreFailed
											? "Retry loading projects"
											: "Load more projects"
								}
								isDisabled={allQuery.isFetchingNextPage}
								onPress={() => {
									void allQuery.fetchNextPage();
								}}
							>
								{allQuery.isFetchingNextPage ? (
									<Loader2Icon className="animate-spin" aria-hidden />
								) : (
									<ChevronDownIcon aria-hidden />
								)}
								<span>
									{allQuery.isFetchingNextPage
										? "Loading..."
										: loadMoreFailed
											? "Retry loading"
											: "Load more"}
								</span>
							</SidebarMenuButton>
						</div>
					</SidebarMenuItem>
				)}
			</SidebarMenu>
		</SidebarGroup>
	);
}

/** One project row. The trailing action pins or unpins. */
function ProjectRowItem({
	project,
	pinned,
	orgSlug,
	pathname,
	isPinning,
	onNavigate,
	onPin,
}: {
	project: ProjectSummary;
	pinned: boolean;
	orgSlug: string;
	pathname: string;
	isPinning: boolean;
	onNavigate: (event: React.MouseEvent, projectSlug: string) => void;
	onPin: (projectId: string, pinned: boolean) => void;
}) {
	const url = `/${orgSlug}/projects/${project.slug}`;
	const active = pathname === url;
	const archived = project.status === "archived";

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				href={url}
				isActive={active}
				aria-current={active ? "page" : undefined}
				tooltip={project.name}
				className={archived ? "text-sidebar-foreground/60" : undefined}
				onClick={(event: React.MouseEvent) => onNavigate(event, project.slug)}
			>
				<UserAvatar
					size="sm"
					shape="square"
					name={project.name}
					src={project.logo}
				/>
				<span className="truncate">{project.name}</span>
				{archived && <span className="sr-only"> (archived)</span>}
			</SidebarMenuButton>

			<SidebarMenuAction
				// A pin is both the state and the action, so it stays visible on
				// pinned rows and appears on hover everywhere else.
				showOnHover={!pinned}
				aria-label={pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
				isDisabled={isPinning}
				onPress={() => onPin(project.id, !pinned)}
			>
				<PinIcon className={pinned ? "fill-current" : undefined} aria-hidden />
			</SidebarMenuAction>
		</SidebarMenuItem>
	);
}
