/**
 * Project archive card.
 *
 * Why a card: archiving is a lifecycle action, separate from editing the
 * identity. It reuses the existing confirmation dialog so the wording and the
 * permission checks stay in one place.
 *
 * Used by: project-general-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { useState } from "react";

import type { ProjectRow } from "../api";
import { ArchiveProjectDialog } from "../archive-project-dialog";

export function ProjectArchiveCard({
	orgSlug,
	project,
}: {
	orgSlug: string;
	project: ProjectRow;
}) {
	const [open, setOpen] = useState(false);
	const archived = project.status === "archived";

	return (
		<section className="flex flex-col border border-app-border bg-app-panel">
			<header className="border-b border-app-border p-4">
				<h2 className="text-sm font-semibold text-app-text">Archive</h2>
				<p className="mt-1 text-sm text-app-text-muted">
					{archived
						? "Restore this project to make it active again."
						: "Archiving keeps the project and its history, but removes it from active work."}
				</p>
			</header>

			<div className="p-4">
				<Button variant="outline" onPress={() => setOpen(true)}>
					{archived ? (
						<ArchiveRestoreIcon aria-hidden />
					) : (
						<ArchiveIcon aria-hidden />
					)}
					{archived ? "Restore project" : "Archive project"}
				</Button>
			</div>

			<ArchiveProjectDialog
				orgSlug={orgSlug}
				project={project}
				mode={archived ? "unarchive" : "archive"}
				isOpen={open}
				onOpenChange={setOpen}
				onChanged={() => setOpen(false)}
			/>
		</section>
	);
}
