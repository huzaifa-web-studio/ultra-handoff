/**
 * Milestone delete confirmation.
 *
 * Why a confirmation at all: deleting a milestone also deletes its body and its
 * assignments, and there is no undo. The dialog names the milestone, because a
 * list row can be deleted from the detail pane while the wrong one is selected.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { useState } from "react";
import { toast } from "sonner";

import { useDeleteMilestone } from "./hooks";

export function MilestoneDeleteDialog({
	orgSlug,
	projectId,
	milestoneId,
	title,
	isOpen,
	onOpenChange,
	onDeleted,
}: {
	orgSlug: string;
	projectId: string;
	milestoneId: string;
	title: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
}) {
	const remove = useDeleteMilestone(orgSlug, projectId);
	const [error, setError] = useState<string | null>(null);

	async function handleDelete() {
		setError(null);

		try {
			await remove.mutateAsync(milestoneId);
			toast.success("Milestone deleted.");
			onOpenChange(false);
			onDeleted();
		} catch (deleteError) {
			setError(
				deleteError instanceof Error
					? deleteError.message
					: "Could not delete the milestone.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDismissable={!remove.isPending}
			showCloseButton={!remove.isPending}
		>
			<DialogHeader>
				<DialogTitle>Delete this milestone?</DialogTitle>
				<DialogDescription>
					"{title}" and its details will be permanently removed. This cannot be
					undone.
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
					isDisabled={remove.isPending}
				>
					Cancel
				</Button>
				<Button
					variant="destructive-solid"
					loading={remove.isPending}
					onPress={() => void handleDelete()}
				>
					Delete milestone
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
