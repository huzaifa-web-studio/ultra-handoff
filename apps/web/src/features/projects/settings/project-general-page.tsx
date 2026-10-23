/**
 * Project general settings page.
 *
 * Why a page component: it composes the identity card, the archive card and the
 * delete card, and it owns the two navigation consequences: a slug change moves
 * the settings URL, and a deletion returns to the projects list.
 *
 * Used by: routes/_app/$orgSlug.projects.$projectSlug.settings.index.tsx.
 */

import { useNavigate } from "@tanstack/react-router";

import { useProjectDetailBySlug } from "../hooks";
import { ProjectErrorState } from "../project-error-state";
import { ProjectArchiveCard } from "./project-archive-card";
import { ProjectDeleteCard } from "./project-delete-card";
import { ProjectGeneralCard } from "./project-general-card";
import { ProjectSettingsSkeleton } from "./project-settings-skeleton";
import { ProjectVisibilityCard } from "./project-visibility-card";

export function ProjectGeneralPage({
	orgSlug,
	projectSlug,
}: {
	orgSlug: string;
	projectSlug: string;
}) {
	const query = useProjectDetailBySlug(orgSlug, projectSlug);
	const navigate = useNavigate();

	if (query.isPending) {
		return <ProjectSettingsSkeleton />;
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

	if (!query.data) return null;

	const { project, viewer, organizationId } = query.data;

	return (
		<div className="flex w-full flex-col gap-6">
			<header className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold text-app-text">General settings</h1>
				<p className="text-app-text-muted">
					Manage how this project appears and its lifecycle.
				</p>
			</header>

			<ProjectGeneralCard
				orgSlug={orgSlug}
				organizationId={organizationId}
				project={project}
				canEdit={viewer.canEdit}
				locked={viewer.locked}
				onSaved={(updated) => {
					// The URL is the slug, so a rename must keep the settings tab
					// on the new address instead of falling into a 404.
					if (updated.project.slug === projectSlug) return;

					navigate({
						to: "/$orgSlug/projects/$projectSlug/settings",
						params: { orgSlug, projectSlug: updated.project.slug },
						replace: true,
					});
				}}
			/>

			{viewer.canEditArchiveVisibility && (
				<ProjectVisibilityCard orgSlug={orgSlug} project={project} />
			)}

			{viewer.canEdit && (
				<ProjectArchiveCard orgSlug={orgSlug} project={project} />
			)}

			{viewer.canDelete && (
				<ProjectDeleteCard
					orgSlug={orgSlug}
					project={project}
					onDeleted={() =>
						navigate({ to: "/$orgSlug/projects", params: { orgSlug } })
					}
				/>
			)}
		</div>
	);
}
