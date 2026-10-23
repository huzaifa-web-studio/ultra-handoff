/**
 * Project delete card.
 *
 * Why a card: permanent deletion is destructive and needs its own space and
 * confirmation. It reuses the existing dialog, which already requires typing the
 * project name.
 *
 * Used by: project-general-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import type { ProjectRow } from "../api";
import { DeleteProjectDialog } from "../delete-project-dialog";

export function ProjectDeleteCard({
	orgSlug,
	project,
	onDeleted,
}: {
	orgSlug: string;
	project: ProjectRow;
	onDeleted: () => void;
}) {
	const [open, setOpen] = useState(false);

	return (
		<section className="flex flex-col border border-danger bg-danger-bg">
			<header className="border-b border-danger/30 p-4">
				<h2 className="text-sm font-semibold text-danger">Delete project</h2>
				<p className="mt-1 text-sm text-danger">
					Permanently remove this project and everything attached to it. This
					cannot be undone.
				</p>
			</header>

			<div className="p-4">
				<Button variant="destructive-solid" onPress={() => setOpen(true)}>
					<Trash2Icon aria-hidden />
					Delete project
				</Button>
			</div>

			<DeleteProjectDialog
				orgSlug={orgSlug}
				project={project}
				isOpen={open}
				onOpenChange={setOpen}
				onDeleted={() => {
					setOpen(false);
					onDeleted();
				}}
			/>
		</section>
	);
}
