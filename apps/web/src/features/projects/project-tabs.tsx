/**
 * Project tabs.
 *
 * Why links instead of a tab widget: each section is a real route, so the URL
 * changes, deep links work and the back button behaves correctly. A nav of
 * links is the accessible pattern for URL driven tabs.
 *
 * The bar also owns the details toggle. The toggle is the only control that
 * affects the layout above it, and keeping it on the tab row means the row never
 * moves when the header collapses.
 *
 * The bar is not sticky because the project workspace itself is a fixed height
 * column now, so the bar is already outside the scrolling area of each tab.
 *
 * Used by: project-workspace.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Tooltip, TooltipTrigger } from "@org/ui/components/tooltip";
import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import {
	ChevronsDownIcon,
	ChevronsUpIcon,
	LayoutDashboardIcon,
	type LucideIcon,
	MilestoneIcon,
	SettingsIcon,
} from "lucide-react";

type ProjectTab = {
	label: string;
	icon: LucideIcon;
	to:
		| "/$orgSlug/projects/$projectSlug"
		| "/$orgSlug/projects/$projectSlug/milestones"
		| "/$orgSlug/projects/$projectSlug/settings";
	path: string;
	exact: boolean;
};

/**
 * The project sections, in display order.
 *
 * `path` is the concrete URL used for the active check, while `to` is the typed
 * route template. Overview is exact so it is not active on a child tab.
 */
function projectTabs(orgSlug: string, projectSlug: string): ProjectTab[] {
	const base = `/${orgSlug}/projects/${projectSlug}`;

	return [
		{
			label: "Overview",
			icon: LayoutDashboardIcon,
			to: "/$orgSlug/projects/$projectSlug",
			path: base,
			exact: true,
		},
		{
			label: "Milestones",
			icon: MilestoneIcon,
			to: "/$orgSlug/projects/$projectSlug/milestones",
			path: `${base}/milestones`,
			exact: false,
		},
		{
			label: "Settings",
			icon: SettingsIcon,
			to: "/$orgSlug/projects/$projectSlug/settings",
			path: `${base}/settings`,
			exact: false,
		},
	];
}

export function ProjectTabs({
	orgSlug,
	projectSlug,
	detailsCollapsed,
	onToggleDetails,
}: {
	orgSlug: string;
	projectSlug: string;
	/** Whether the identity block above the tabs is currently hidden. */
	detailsCollapsed: boolean;
	onToggleDetails: () => void;
}) {
	const { pathname } = useLocation();
	const tabs = projectTabs(orgSlug, projectSlug);

	// The label describes the action, not the state, so it always matches what
	// pressing the button does.
	const toggleLabel = detailsCollapsed
		? "Expand project details"
		: "Collapse project details";

	return (
		/*
		 * When the details are collapsed the shell's 32px top padding is the
		 * only thing left above the row, so it reads as a dead band under the
		 * app header. Pulling the row up by 16px halves that gap while the
		 * transition keeps the change in step with the collapsing header.
		 */
		<div
			className={cn(
				"flex shrink-0 items-stretch gap-2 border-b border-app-border px-8 transition-[margin] duration-300 ease-out",
				detailsCollapsed && "-mt-4",
			)}
		>
			<nav
				aria-label="Project sections"
				className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
			>
				{tabs.map((tab) => {
					const active = tab.exact
						? pathname === tab.path
						: pathname === tab.path || pathname.startsWith(`${tab.path}/`);
					const Icon = tab.icon;

					return (
						<Link
							key={tab.label}
							to={tab.to}
							params={{ orgSlug, projectSlug }}
							aria-current={active ? "page" : undefined}
							className={cn(
								"flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
								active
									? "border-app-focus text-app-text"
									: "border-transparent text-app-text-muted hover:text-app-text",
							)}
						>
							<Icon className="size-4" aria-hidden />
							{/*
							 * Below `sm` the three labels plus the toggle overflow the
							 * row, so the tabs collapse to icons and keep their names
							 * for screen readers.
							 */}
							<span className="sr-only sm:not-sr-only">{tab.label}</span>
						</Link>
					);
				})}
			</nav>

			{/* Pinned to the right so it never scrolls away with the tabs. */}
			<div className="flex shrink-0 items-center">
				<TooltipTrigger>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={toggleLabel}
						aria-expanded={!detailsCollapsed}
						aria-controls="project-details"
						onPress={onToggleDetails}
					>
						{detailsCollapsed ? (
							<ChevronsDownIcon className="size-4" aria-hidden />
						) : (
							<ChevronsUpIcon className="size-4" aria-hidden />
						)}
					</Button>
					<Tooltip placement="bottom">{toggleLabel}</Tooltip>
				</TooltipTrigger>
			</div>
		</div>
	);
}
