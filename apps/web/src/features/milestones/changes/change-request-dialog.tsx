"use client";

/**
 * Create or edit a change request.
 *
 * Why one dialog for both: the fields are identical, and the only difference is
 * which mutation runs. Keeping one component means the editor, the attachment
 * handling and the validation cannot drift between "ask" and "fix the ask".
 *
 * The editor is the same one a comment uses, so the client gets mentions, link
 * cards, images, tables and attachments without a second rich text stack.
 *
 * Used by: changes-tab.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Input } from "@org/ui/components/input";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CommentEditor } from "../comments/editor/comment-editor";
import { CommentToolbar } from "../comments/editor/comment-toolbar";
import { MILESTONE_TITLE_MAX } from "../schema";
import type { ChangeRequest } from "./api";
import { useCreateChangeRequest, useUpdateChangeRequest } from "./hooks";

export function ChangeRequestDialog({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	request,
	isOpen,
	onOpenChange,
	onSaved,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string;
	/** Present when editing an open request. */
	request?: ChangeRequest | null;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved?: (request: ChangeRequest) => void;
}) {
	const create = useCreateChangeRequest(orgSlug, projectId, milestoneId);
	const update = useUpdateChangeRequest(orgSlug, projectId, milestoneId);
	const editing = Boolean(request);
	const pending = editing ? update.isPending : create.isPending;

	const [title, setTitle] = useState(request?.title ?? "");
	const [draft, setDraft] = useState<unknown[]>(request?.body ?? []);
	// Bumped by an external reset, so the editor remounts with the new value.
	const [editorVersion, setEditorVersion] = useState(0);
	const [attachmentUploading, setAttachmentUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// The dialog is mounted only while open, but switching from one request to
	// another without unmounting must still reset the draft.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset for a new request
	useEffect(() => {
		setTitle(request?.title ?? "");
		setDraft(request?.body ?? []);
		setEditorVersion((current) => current + 1);
	}, [request?.id, request?.title, request?.body]);

	const canSubmit = title.trim().length > 0 && !pending && !attachmentUploading;

	async function submit() {
		if (!canSubmit) return;

		setError(null);

		try {
			if (request) {
				const result = await update.mutateAsync({
					changeId: request.id,
					title: title.trim(),
					body: draft,
				});

				toast.success("Change request updated.");
				onSaved?.(result.changeRequest);
			} else {
				const result = await create.mutateAsync({
					title: title.trim(),
					body: draft,
				});

				toast.success("Change request sent.");
				onSaved?.(result.changeRequest);
			}

			onOpenChange(false);
		} catch (submitError) {
			setError(
				submitError instanceof Error
					? submitError.message
					: "Could not save the change request.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDismissable={!pending}
			showCloseButton={!pending}
			className="sm:max-w-4xl"
		>
			<form
				className="flex max-h-[75svh] flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{editing ? "Edit change request" : "New change request"}
					</DialogTitle>
					<DialogDescription>
						{editing
							? "Only the person who wrote it can edit a request while it is open."
							: "Describe what needs to change. The agency can accept it, decline it, or move it into a new milestone."}
					</DialogDescription>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
					<div className="flex flex-col gap-1">
						<label
							htmlFor="change-request-title"
							className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
						>
							Title
						</label>
						<Input
							id="change-request-title"
							autoFocus
							value={title}
							maxLength={MILESTONE_TITLE_MAX}
							placeholder="What needs to change?"
							onChange={(event) => setTitle(event.target.value)}
							aria-invalid={error !== null && title.trim().length === 0}
						/>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							Details
						</span>
						<div className="border border-app-border bg-app-panel transition-colors focus-within:border-app-focus">
							<CommentEditor
								key={editorVersion}
								initialValue={request?.body ?? []}
								onChange={setDraft}
								onSubmit={() => void submit()}
								readOnly={pending}
								organizationId={organizationId}
								organizationSlug={orgSlug}
								onUploadingChange={setAttachmentUploading}
								ariaLabel="Change request details"
								placeholder="Explain the change, add a reference, or attach a file..."
								footer={
									<div className="border-t border-app-border px-1.5 py-1">
										<CommentToolbar
											organizationId={organizationId}
											organizationSlug={orgSlug}
											onUploadingChange={setAttachmentUploading}
										/>
									</div>
								}
							/>
						</div>
					</div>
				</div>

				{error && (
					<p role="alert" className="text-sm text-danger">
						{error}
					</p>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onPress={() => onOpenChange(false)}
						isDisabled={pending}
					>
						Cancel
					</Button>
					<Button type="submit" loading={pending} isDisabled={!canSubmit}>
						{editing ? "Save changes" : "Send request"}
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
