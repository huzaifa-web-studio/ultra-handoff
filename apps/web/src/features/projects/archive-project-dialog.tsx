/**
 * Archive and restore confirmation.
 *
 * Why a dialog instead of an immediate action: archiving changes what the rest
 * of the workspace sees by default, so the consequences should be readable
 * before the click. Restoring uses the same dialog with different copy.
 *
 * Used by: routes/_app/$orgSlug.projects.index.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ProjectRow } from "./api";
import { useArchiveProject, useUnarchiveProject } from "./hooks";

type ArchiveProjectDialogProps = {
	orgSlug: string;
	project: ProjectRow | null;
	mode: "archive" | "unarchive";
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged: () => void;
};

export function ArchiveProjectDialog({
	orgSlug,
	project,
	mode,
	isOpen,
	onOpenChange,
	onChanged,
}: ArchiveProjectDialogProps) {
	const archive = useArchiveProject(orgSlug);
	const unarchive = useUnarchiveProject(orgSlug);
	const [error, setError] = useState<string | null>(null);

	const pending = archive.isPending || unarchive.isPending;
	const archiving = mode === "archive";

	// Clear a previous failure when the dialog is opened again.
	useEffect(() => {
		if (isOpen) setError(null);
	}, [isOpen]);

	async function handleConfirm() {
		if (!project) return;

		setError(null);

		try {
			if (archiving) {
				await archive.mutateAsync(project.id);
				toast.success(`${project.name} was archived.`);
			} else {
				await unarchive.mutateAsync(project.id);
				toast.success(`${project.name} was restored.`);
			}

			onChanged();
			onOpenChange(false);
		} catch (actionError) {
			setError(
				actionError instanceof Error
					? actionError.message
					: `Could not ${archiving ? "archive" : "restore"} the project.`,
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDismissable={!pending}
			showCloseButton={!pending}
		>
			<DialogHeader>
				<DialogTitle>
					{archiving ? "Archive project" : "Restore project"}
				</DialogTitle>
				<DialogDescription>
					{archiving
						? `${project?.name ?? "This project"} becomes read-only. Its members and clients stop seeing it, and nobody can change it until it is restored. Owners and admins keep access so it can be restored or deleted.${
								project?.archiveVisibleToClient
									? " Clients keep seeing it because client visibility is enabled for archived projects."
									: ""
							}`
						: `${project?.name ?? "This project"} becomes active again and editable. Its members and clients see it as before. Nothing else changes.`}
				</DialogDescription>
			</DialogHeader>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			<DialogFooter>
				<Button
					variant="outline"
					onPress={() => onOpenChange(false)}
					isDisabled={pending}
				>
					Cancel
				</Button>
				<Button loading={pending} onPress={handleConfirm}>
					{archiving ? "Archive project" : "Restore project"}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
