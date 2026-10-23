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
		 * Sticky so the section switcher stays available while a long tab
		 * scrolls. The negative margin cancels the page padding, which lets the
		 * bar span the full content width with an opaque background.
		 */
		<nav
			aria-label="Project sections"
			className="sticky top-0 z-20 -mx-8 flex gap-1 overflow-x-auto border-b border-app-border bg-background px-8"
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
	);
}
