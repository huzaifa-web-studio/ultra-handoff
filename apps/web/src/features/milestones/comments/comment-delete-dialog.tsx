"use client";

/**
 * Comment delete confirmation.
 *
 * Why a confirmation at all: deleting blanks the body for everyone, and there is
 * no undo. The dialog names the author so it cannot be triggered for the wrong
 * row in a long thread.
 *
 * Only the author can reach this dialog, because the API only sends
 * `canDelete: true` to the author of a live comment.
 *
 * Used by: comment-tab.tsx.
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

import type { Comment } from "./api";
import { useDeleteComment } from "./hooks";

export function CommentDeleteDialog({
	orgSlug,
	projectId,
	milestoneId,
	comment,
	isOpen,
	onOpenChange,
	onDeleted,
}: {
	orgSlug: string;
	projectId: string;
	milestoneId: string;
	comment: Comment | null;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
}) {
	const remove = useDeleteComment(orgSlug, projectId, milestoneId);
	const [error, setError] = useState<string | null>(null);

	async function handleDelete() {
		if (!comment) return;

		setError(null);

		try {
			await remove.mutateAsync(comment.id);
			onOpenChange(false);
			onDeleted();
		} catch (deleteError) {
			setError(
				deleteError instanceof Error
					? deleteError.message
					: "Could not delete the comment.",
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
				<DialogTitle>Delete this comment?</DialogTitle>
				<DialogDescription>
					{comment?.author?.name
						? `The comment from ${comment.author.name} will be replaced with a deleted note.`
						: "The comment will be replaced with a deleted note."}{" "}
					Any replies stay in the thread. This cannot be undone.
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
					Delete comment
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
