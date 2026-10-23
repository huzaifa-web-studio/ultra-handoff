/**
 * Project settings layout.
 *
 * Why a layout: settings has more than one section, and the internal navigation
 * belongs to all of them. The project header and tabs above come from the
 * project workspace layout, so this only splits the remaining space into a left
 * settings nav and the section content.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.settings.tsx.
 */

import { Outlet } from "@tanstack/react-router";

import { ProjectSettingsNav } from "./project-settings-nav";

export function ProjectSettingsLayout({
	orgSlug,
	projectSlug,
}: {
	orgSlug: string;
	projectSlug: string;
}) {
	return (
		<div className="grid w-full gap-6 md:grid-cols-[14rem_1fr]">
			<ProjectSettingsNav orgSlug={orgSlug} projectSlug={projectSlug} />
			<div className="min-w-0">
				<Outlet />
			</div>
		</div>
	);
}
