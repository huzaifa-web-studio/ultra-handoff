/**
 * Projects table empty state.
 *
 * Why a component: the table renders it in place of rows, and the message has
 * to change with the caller's permissions, the status filter and whether the
 * workspace has any projects at all. Keeping that branching out of the page
 * makes the table wiring easier to read.
 *
 * Used by: projects-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import { PlusIcon } from "lucide-react";

import type { ProjectListFilters } from "./api";

export function ProjectsEmptyState({
	hasProjects,
	hasArchived,
	status,
	canCreate,
	onCreate,
	onClear,
}: {
	hasProjects: boolean;
	hasArchived: boolean;
	status: ProjectListFilters["status"];
	canCreate: boolean;
	onCreate: () => void;
	onClear: () => void;
}) {
	if (!hasProjects) {
		return (
			<div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
				<p className="text-sm text-app-text-muted">
					{canCreate
						? "No projects yet. Create the first one for this organization."
						: "You are not a member of any project yet. An organization owner or admin can add you."}
				</p>
				{canCreate && (
					<Button variant="outline" onPress={onCreate}>
						<PlusIcon aria-hidden />
						Create your first project
					</Button>
				)}
			</div>
		);
	}

	if (status === "archived" && !hasArchived) {
		return (
			<div className="px-3 py-10 text-center text-sm text-app-text-muted">
				No archived projects.
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
			<p className="text-sm text-app-text-muted">
				No projects match your filters.
			</p>
			<Button variant="outline" onPress={onClear}>
				Clear filters
			</Button>
		</div>
	);
}
