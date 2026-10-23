/**
 * Confirm deleting several projects at once.
 *
 * Why a dialog: permanent delete is the one bulk action that cannot be undone,
 * so the user sees exactly which projects will go and which will be skipped
 * before the request runs. Blocked rows are pre-sorted here so the confirmation
 * never promises something the API will refuse.
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
import { CheckIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { BulkResultList } from "#/components/bulk-result-list";
import { beginOrganizationOperation } from "#/features/organization/switch-guard";
import type { ProjectBulkItemResult, ProjectRow } from "./api";
import { useBulkDeleteProjects } from "./hooks";

type BulkDeleteProjectsDialogProps = {
	organizationId: string;
	orgSlug: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	projects: ProjectRow[];
	/** Clear the table selection after a successful removal. */
	onDeleted: () => void;
};

type Blocked = { project: ProjectRow; reason: string };

export function BulkDeleteProjectsDialog({
	organizationId,
	orgSlug,
	isOpen,
	onOpenChange,
	projects,
	onDeleted,
}: BulkDeleteProjectsDialogProps) {
	const [results, setResults] = useState<ProjectBulkItemResult[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const mutation = useBulkDeleteProjects(orgSlug);

	const { deletable, blocked } = useMemo(() => {
		const deletableRows: ProjectRow[] = [];
		const blockedRows: Blocked[] = [];

		for (const project of projects) {
			if (!project.canDelete) {
				blockedRows.push({
					project,
					reason: "Only a project owner can delete this project.",
				});
				continue;
			}

			deletableRows.push(project);
		}

		return { deletable: deletableRows, blocked: blockedRows };
	}, [projects]);

	async function handleDelete() {
		if (deletable.length === 0 || mutation.isPending) return;

		setError(null);

		// Deleting projects also removes uploaded logos, so it can take a
		// moment. The switch guard stops the workspace from changing under it.
		const operation = beginOrganizationOperation({
			organizationId,
			organizationSlug: orgSlug,
			reason: `Deleting ${deletable.length} project${
				deletable.length === 1 ? "" : "s"
			}`,
		});

		try {
			const data = await mutation.mutateAsync(
				deletable.map((project) => project.id),
			);

			setResults(data.results);

			const deleted = data.results.filter(
				(result) => result.status === "deleted",
			).length;

			if (deleted > 0) {
				toast.success(`${deleted} project${deleted === 1 ? "" : "s"} deleted.`);
			}
		} catch (deleteError) {
			setError(
				deleteError instanceof Error
					? deleteError.message
					: "Could not delete those projects.",
			);
		} finally {
			operation.end();
		}
	}

	function close() {
		onOpenChange(false);
		setError(null);

		if (results) {
			setResults(null);
			onDeleted();
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{results
						? "Bulk delete results"
						: deletable.length === 0
							? "No projects can be deleted"
							: `Delete ${deletable.length} project${
									deletable.length === 1 ? "" : "s"
								}?`}
				</DialogTitle>
			</DialogHeader>
			<DialogDescription>
				This permanently removes the projects, their member lists and their
				uploaded logos. It cannot be undone. Archive is the reversible option.
			</DialogDescription>

			<div className="flex flex-col gap-4">
				{deletable.length > 0 && (
					<ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
						{deletable.slice(0, 8).map((project) => (
							<li key={project.id} className="truncate text-app-text">
								{project.name}{" "}
								<span className="text-app-text-muted">({project.slug})</span>
							</li>
						))}
						{deletable.length > 8 && (
							<li className="text-app-text-muted">
								and {deletable.length - 8} more
							</li>
						)}
					</ul>
				)}

				{blocked.length > 0 && (
					<div className="flex flex-col gap-2 border border-warning bg-warning-bg p-3">
						<p className="text-xs font-semibold tracking-wide text-warning uppercase">
							Will be skipped
						</p>
						<ul className="flex flex-col gap-1 text-sm text-warning">
							{blocked.map(({ project, reason }) => (
								<li key={project.id}>
									{project.name}: {reason}
								</li>
							))}
						</ul>
					</div>
				)}

				{error && (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
				)}

				{results && (
					<BulkResultList results={results} label="Deleted projects" />
				)}
			</div>

			<DialogFooter>
				{results ? (
					<Button onPress={close}>
						<CheckIcon aria-hidden />
						Done
					</Button>
				) : (
					<>
						<Button
							variant="outline"
							onPress={close}
							isDisabled={mutation.isPending}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							loading={mutation.isPending}
							isDisabled={deletable.length === 0}
							onPress={handleDelete}
						>
							<Trash2Icon aria-hidden />
							Delete
						</Button>
					</>
				)}
			</DialogFooter>
		</Dialog>
	);
}
