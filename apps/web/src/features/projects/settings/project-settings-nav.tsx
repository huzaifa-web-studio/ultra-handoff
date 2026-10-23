/**
 * Project settings internal navigation.
 *
 * Why one component with responsive layout: on desktop this is a settings
 * sidebar, and on small screens the same links become a tab bar. The links are
 * routes, so the URL changes, deep links work and the settings tab stays active.
 *
 * Used by: project-settings-layout.tsx.
 */

import { Link, useLocation } from "@tanstack/react-router";
import { cn } from "cn";
import { SlidersHorizontalIcon, UsersIcon } from "lucide-react";

function settingsLinks(orgSlug: string, projectSlug: string) {
	const base = `/${orgSlug}/projects/${projectSlug}/settings`;

	return [
		{
			label: "General",
			icon: SlidersHorizontalIcon,
			to: "/$orgSlug/projects/$projectSlug/settings" as const,
			path: base,
			exact: true,
		},
		{
			label: "Members",
			icon: UsersIcon,
			to: "/$orgSlug/projects/$projectSlug/settings/members" as const,
			path: `${base}/members`,
			exact: false,
		},
	];
}

export function ProjectSettingsNav({
	orgSlug,
	projectSlug,
}: {
	orgSlug: string;
	projectSlug: string;
}) {
	const { pathname } = useLocation();
	const links = settingsLinks(orgSlug, projectSlug);

	return (
		<nav
			aria-label="Project settings"
			className={cn(
				// Small screens: a horizontal tab bar.
				"flex gap-1 overflow-x-auto border-b border-app-border",
				// Desktop: a vertical settings sidebar.
				"md:flex-col md:self-start md:gap-1 md:overflow-visible md:border md:bg-app-panel md:p-2",
			)}
		>
			{links.map((link) => {
				const Icon = link.icon;
				const active = link.exact
					? pathname === link.path
					: pathname === link.path || pathname.startsWith(`${link.path}/`);

				return (
					<Link
						key={link.label}
						to={link.to}
						params={{ orgSlug, projectSlug }}
						aria-current={active ? "page" : undefined}
						className={cn(
							"flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors md:flex-none md:justify-start md:border-b-0",
							active
								? "border-app-focus text-app-text md:bg-app-selected md:font-medium"
								: "border-transparent text-app-text-muted hover:text-app-text md:hover:bg-app-panel-subtle",
						)}
					>
						<Icon className="size-4" aria-hidden />
						{link.label}
					</Link>
				);
			})}
		</nav>
	);
}
