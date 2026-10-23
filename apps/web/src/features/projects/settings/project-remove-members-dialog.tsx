/**
 * Remove people from a project.
 *
 * Why a dialog: removal is destructive and can affect one row or a selected
 * batch. The dialog names everyone affected before the request runs.
 *
 * Used by: project-members-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { ProjectMemberRow } from "../api";
import { useBulkRemoveProjectMembers } from "../hooks";

export function ProjectRemoveMembersDialog({
	orgSlug,
	projectId,
	members,
	isOpen,
	onOpenChange,
	onRemoved,
}: {
	orgSlug: string;
	projectId: string;
	members: ProjectMemberRow[];
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onRemoved: () => void;
}) {
	const removeMembers = useBulkRemoveProjectMembers(orgSlug, projectId);
	const [error, setError] = useState<string | null>(null);

	async function handleRemove() {
		if (members.length === 0) return;

		setError(null);

		try {
			const response = await removeMembers.mutateAsync(
				members.map((member) => member.userId),
			);

			const removed = response.results.filter(
				(item) => item.status === "removed",
			).length;
			const skipped = response.results.length - removed;

			if (removed > 0) {
				toast.success(
					`${removed} ${removed === 1 ? "person" : "people"} removed from the project.`,
				);
			}

			if (skipped > 0) {
				toast.warning(
					`${skipped} ${skipped === 1 ? "person was" : "people were"} skipped.`,
					{
						description: "You can only remove people below your project role.",
					},
				);
			}

			onRemoved();
			onOpenChange(false);
		} catch (removeError) {
			setError(
				removeError instanceof Error
					? removeError.message
					: "Could not remove those people.",
			);
		}
	}

	return (
		<Dialog isOpen={isOpen} onOpenChange={onOpenChange}>
			<DialogHeader>
				<DialogTitle>
					Remove {members.length === 1 ? "member" : "members"}?
				</DialogTitle>
				<DialogDescription>
					They lose access to this project immediately. You can add them again
					later.
				</DialogDescription>
			</DialogHeader>

			<ul className="flex flex-col gap-1 border border-app-border bg-app-panel-subtle p-3">
				{members.map((member) => (
					<li key={member.userId} className="text-sm text-app-text">
						<span className="font-medium">{member.name}</span>
						<span className="text-app-text-muted"> {member.email}</span>
					</li>
				))}
			</ul>

			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}

			<DialogFooter>
				<Button
					variant="outline"
					onPress={() => onOpenChange(false)}
					isDisabled={removeMembers.isPending}
				>
					Cancel
				</Button>
				<Button
					variant="destructive"
					loading={removeMembers.isPending}
					onPress={handleRemove}
				>
					<Trash2Icon aria-hidden />
					Remove {members.length}
				</Button>
			</DialogFooter>
		</Dialog>
	);
}
