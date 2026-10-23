/**
 * Project tabs.
 *
 * Why links instead of a tab widget: each section is a real route, so the URL
 * changes, deep links work and the back button behaves correctly. A nav of
 * links is the accessible pattern for URL driven tabs.
 *
 * Used by: project-workspace.tsx.
 */

import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";

/**
 * The project sections, in display order.
 *
 * `path` is the concrete URL used for the active check, while `to` is the typed
 * route template. Overview is exact so it is not active on a child tab.
 */
function projectTabs(orgSlug: string, projectSlug: string) {
	const base = `/${orgSlug}/projects/${projectSlug}`;

	return [
		{
			label: "Overview",
			to: "/$orgSlug/projects/$projectSlug" as const,
			path: base,
			exact: true,
		},
		{
			label: "Milestones",
			to: "/$orgSlug/projects/$projectSlug/milestones" as const,
			path: `${base}/milestones`,
			exact: false,
		},
		{
			label: "Settings",
			to: "/$orgSlug/projects/$projectSlug/settings" as const,
			path: `${base}/settings`,
			exact: false,
		},
	];
}

export function ProjectTabs({
	orgSlug,
	projectSlug,
}: {
	orgSlug: string;
	projectSlug: string;
}) {
	const { pathname } = useLocation();
	const tabs = projectTabs(orgSlug, projectSlug);

	return (
		/*
		 * The wrapper cancels the shell padding so the tab bar can span the full
		 * content width and stick flush under the app header. Each section adds
		 * its own padding back, which keeps the header spacing without leaving a
		 * strip above the sticky bar.
		 */
		/*
		 * `-top-8` cancels the page padding for the sticky position only. Without
		 * it the bar sticks 32px below the scrollport edge, leaving a strip of
		 * background between the app header and the tabs.
		 */
		<div className="sticky -top-8 z-20 bg-background">
			<nav
				aria-label="Project sections"
				className="flex gap-1 overflow-x-auto border-b border-app-border px-8"
			>
				{tabs.map((tab) => {
					const active = tab.exact
						? pathname === tab.path
						: pathname === tab.path || pathname.startsWith(`${tab.path}/`);

					return (
						<Link
							key={tab.label}
							to={tab.to}
							params={{ orgSlug, projectSlug }}
							aria-current={active ? "page" : undefined}
							className={cn(
								"shrink-0 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
								active
									? "border-app-focus text-app-text"
									: "border-transparent text-app-text-muted hover:text-app-text",
							)}
						>
							{tab.label}
						</Link>
					);
				})}
			</nav>
		</div>
	);
}
