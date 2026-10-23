/**
 * Project archive visibility card.
 *
 * Why a card: archiving hides a project from its members and clients, and this
 * is the one per project exception. It belongs in General settings next to the
 * archive control so the consequence of archiving is discoverable before the
 * project is archived.
 *
 * The setting stays editable while the project is archived, because that is
 * exactly when it matters. Everything else on an archived project is read only.
 *
 * Used by: project-general-page.tsx.
 */

import { Checkbox } from "@org/ui/components/checkbox";
import { toast } from "sonner";

import type { ProjectRow } from "../api";
import { useSetProjectArchiveVisibility } from "../hooks";

export function ProjectVisibilityCard({
	orgSlug,
	project,
}: {
	orgSlug: string;
	project: ProjectRow;
}) {
	const updateVisibility = useSetProjectArchiveVisibility(orgSlug);
	const archived = project.status === "archived";

	function handleChange(visibleToClient: boolean) {
		updateVisibility.mutate(
			{ projectId: project.id, visibleToClient },
			{
				onSuccess: () => {
					toast.success(
						visibleToClient
							? "Clients will keep seeing this project while it is archived."
							: "Clients will not see this project while it is archived.",
					);
				},
				onError: (error) => {
					toast.error(
						error instanceof Error
							? error.message
							: "Could not change the archive visibility.",
					);
				},
			},
		);
	}

	return (
		<section className="flex flex-col border border-app-border bg-app-panel">
			<header className="border-b border-app-border p-4">
				<h2 className="text-sm font-semibold text-app-text">
					Archive visibility
				</h2>
				<p className="mt-1 text-sm text-app-text-muted">
					{archived
						? "This project is archived. Choose whether its clients can still open it."
						: "Choose whether clients keep access after this project is archived."}
				</p>
			</header>

			<div className="flex items-start gap-3 p-4">
				<Checkbox
					isSelected={project.archiveVisibleToClient}
					onChange={handleChange}
					isDisabled={updateVisibility.isPending}
					aria-label="Show this project to clients while archived"
					aria-describedby="archive-visibility-description"
				/>
				<div className="flex flex-col gap-1">
					<span className="text-sm font-medium text-app-text">
						Show this project to clients while archived
					</span>
					<p
						id="archive-visibility-description"
						className="text-sm text-app-text-muted"
					>
						When this is off, archiving removes the project from the client
						view. When it is on, clients keep read only access. Project members
						never see an archived project, and owners and admins always do.
					</p>
				</div>
			</div>
		</section>
	);
}
