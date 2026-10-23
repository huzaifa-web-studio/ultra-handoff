/**
 * Project general settings card.
 *
 * Why a card: the settings page groups independent concerns. This one edits the
 * project identity, and it shows a read only summary for callers who cannot
 * edit instead of disabled inputs they could never submit.
 *
 * The form itself is shared with the create/edit dialog, so validation, logo
 * upload and the slug suggestion behave identically.
 *
 * Used by: project-general-page.tsx.
 */

import { UserAvatar } from "#/components/user-avatar";
import type { ProjectDetailResponse, ProjectRow } from "../api";
import { ProjectGeneralForm } from "../project-general-form";

export function ProjectGeneralCard({
	orgSlug,
	organizationId,
	project,
	canEdit,
	onSaved,
}: {
	orgSlug: string;
	organizationId: string;
	project: ProjectRow;
	canEdit: boolean;
	onSaved: (project: ProjectDetailResponse) => void;
}) {
	return (
		<section className="flex flex-col border border-app-border bg-app-panel">
			<header className="border-b border-app-border p-4">
				<h2 className="text-sm font-semibold text-app-text">General</h2>
				<p className="mt-1 text-sm text-app-text-muted">
					Update the project name, address, description and logo.
				</p>
			</header>

			<div className="p-4">
				{canEdit ? (
					<ProjectGeneralForm
						orgSlug={orgSlug}
						organizationId={organizationId}
						mode="edit"
						project={project}
						onSaved={onSaved}
						saveLogoImmediately
					/>
				) : (
					<ProjectGeneralSummary project={project} />
				)}
			</div>
		</section>
	);
}

/** The read only view for viewers who cannot edit. */
function ProjectGeneralSummary({ project }: { project: ProjectRow }) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-3">
				<UserAvatar
					size="lg"
					shape="square"
					name={project.name}
					src={project.logo}
				/>
				<div className="flex min-w-0 flex-col">
					<span className="truncate font-medium text-app-text">
						{project.name}
					</span>
					<span className="truncate text-sm text-app-text-muted">
						/{project.slug}
					</span>
				</div>
			</div>

			<p className="text-sm text-app-text-muted">
				{project.description || "No description yet."}
			</p>

			<p className="text-xs text-app-text-muted">
				Only project owners and admins can change these details.
			</p>
		</div>
	);
}
