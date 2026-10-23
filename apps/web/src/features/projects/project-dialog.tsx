/**
 * Create and edit project dialog.
 *
 * Why a thin wrapper: the form itself is shared with the project settings page,
 * so this file only owns the dialog chrome and the open/close behaviour.
 *
 * Used by: projects-page.tsx (create and edit).
 */

import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { useState } from "react";

import type { ProjectDetailResponse, ProjectRow } from "./api";
import { ProjectGeneralForm } from "./project-general-form";

type ProjectDialogProps = {
	orgSlug: string;
	organizationId: string;
	mode: "create" | "edit";
	/** Required in edit mode. */
	project?: ProjectRow;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called after a successful create, so the list can reveal the new row. */
	onCreated?: () => void;
	/**
	 * Called after a successful edit with the saved project. The project page
	 * uses it to follow a slug change, because the URL is the slug.
	 */
	onUpdated?: (project: ProjectDetailResponse) => void;
};

export function ProjectDialog({
	orgSlug,
	organizationId,
	mode,
	project,
	isOpen,
	onOpenChange,
	onCreated,
	onUpdated,
}: ProjectDialogProps) {
	const [isSubmitting, setIsSubmitting] = useState(false);

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			className="sm:max-w-lg"
			isDismissable={!isSubmitting}
			showCloseButton={!isSubmitting}
		>
			<DialogHeader>
				<DialogTitle>
					{mode === "create" ? "New project" : "Edit project"}
				</DialogTitle>
				<DialogDescription>
					{mode === "create"
						? "A project holds the scope, deliverables and approvals for one client engagement."
						: "Update how this project appears to its members."}
				</DialogDescription>
			</DialogHeader>

			<ProjectGeneralForm
				orgSlug={orgSlug}
				organizationId={organizationId}
				mode={mode}
				project={project}
				onCancel={() => onOpenChange(false)}
				onCreated={() => {
					onCreated?.();
					onOpenChange(false);
				}}
				onSaved={(updated) => {
					onUpdated?.(updated);
					onOpenChange(false);
				}}
				onSubmittingChange={setIsSubmitting}
				confirmLogoRemoval={false}
			/>
		</Dialog>
	);
}
