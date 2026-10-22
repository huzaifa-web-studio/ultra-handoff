/**
 * Permanent project delete confirmation.
 *
 * Why a typed confirmation: deleting a project also removes every project
 * membership and the logo, and neither archive nor any other screen can bring
 * it back. Typing the name is a deliberate speed bump, not a formality.
 *
 * Used by: routes/_app/$orgSlug.projects.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@org/ui/components/field";
import { Input } from "@org/ui/components/input";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ProjectRow } from "./api";
import { useDeleteProject } from "./hooks";

type DeleteProjectDialogProps = {
	orgSlug: string;
	project: ProjectRow | null;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
};

export function DeleteProjectDialog({
	orgSlug,
	project,
	isOpen,
	onOpenChange,
	onDeleted,
}: DeleteProjectDialogProps) {
	const deleteProject = useDeleteProject(orgSlug);
	const [confirmation, setConfirmation] = useState("");
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		setConfirmation("");
		setError(null);
	}, [isOpen]);

	const matches = project ? confirmation.trim() === project.name : false;

	async function handleDelete() {
		if (!project || !matches) return;

		setError(null);

		try {
			await deleteProject.mutateAsync(project.id);
			toast.success(`${project.name} was deleted.`);
			onDeleted();
			onOpenChange(false);
		} catch (deleteError) {
			setError(
				deleteError instanceof Error
					? deleteError.message
					: "Could not delete the project.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDismissable={!deleteProject.isPending}
			showCloseButton={!deleteProject.isPending}
		>
			<DialogHeader>
				<DialogTitle>Delete project</DialogTitle>
				<DialogDescription>
					This permanently deletes{" "}
					<span className="select-text font-medium text-app-text">
						{project?.name ?? "this project"}
					</span>
					, its member list and its logo. Deliverables and approvals added later
					will be deleted with it. This cannot be undone.
				</DialogDescription>
			</DialogHeader>

			<Field>
				<FieldLabel htmlFor="delete-project-confirmation">
					{/* Keep the project name selectable so it can be copied into the
					    confirmation input below, despite the label's select-none. */}
					<span className="select-text">
						Type {project?.name ?? "the project name"} to confirm
					</span>
				</FieldLabel>
				<Input
					id="delete-project-confirmation"
					type="text"
					autoComplete="off"
					value={confirmation}
					onChange={(event) => setConfirmation(event.target.value)}
					disabled={deleteProject.isPending}
				/>
				<FieldError
					errors={
						confirmation.length > 0 && !matches
							? [{ message: "The name does not match." }]
							: []
					}
				/>
			</Field>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			<DialogFooter>
				<Button
					variant="outline"
					onPress={() => onOpenChange(false)}
					isDisabled={deleteProject.isPending}
				>
					Cancel
				</Button>
				<Button
					variant="outline"
					className="text-danger hover:bg-danger-bg hover:text-danger"
					loading={deleteProject.isPending}
					isDisabled={!matches}
					onPress={handleDelete}
				>
					Delete project
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
