"use client";

/**
 * Accept a change request into the milestone scope.
 *
 * Why a dialog and not a one click accept: the accepted text becomes a named
 * section under the initial scope, so the agency must see exactly what will be
 * added. The title and body are prefilled from the request and can be trimmed,
 * which is what makes partial acceptance possible without rewriting history.
 *
 * The body is only sent when it changed. An unchanged body is trusted by the
 * server, so a mention of somebody who has since left cannot block the
 * decision.
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
import { Textarea } from "@org/ui/components/textarea";
import { useRef, useState } from "react";
import { CommentEditor } from "../comments/editor/comment-editor";
import { MILESTONE_NOTE_MAX, MILESTONE_TITLE_MAX } from "../schema";
import type { ChangeRequest } from "./api";
import { useDecideChangeRequest } from "./hooks";

export function ChangeRequestAcceptDialog({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	request,
	isOpen,
	onOpenChange,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string;
	request: ChangeRequest;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const decide = useDecideChangeRequest(orgSlug, projectId, milestoneId);
	const [title, setTitle] = useState(request.title);
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	const bodyRef = useRef<unknown[]>(request.body);

	const trimmedTitle = title.trim();
	const pending = decide.isPending;

	async function submit() {
		if (trimmedTitle.length === 0) {
			setError("Give the accepted scope a title.");
			return;
		}

		const bodyChanged =
			JSON.stringify(bodyRef.current) !== JSON.stringify(request.body);

		setError(null);

		try {
			await decide.mutateAsync({
				changeId: request.id,
				status: "accepted",
				scopeTitle: trimmedTitle,
				...(bodyChanged ? { scopeBody: bodyRef.current } : {}),
				...(note.trim().length > 0 ? { note: note.trim() } : {}),
			});

			onOpenChange(false);
		} catch (acceptError) {
			setError(
				acceptError instanceof Error
					? acceptError.message
					: "Could not accept the change request.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			className="sm:max-w-2xl"
			isDismissable={!pending}
			showCloseButton={!pending}
		>
			<div className="flex max-h-[75svh] flex-col gap-4">
				<DialogHeader>
					<DialogTitle>Accept into scope</DialogTitle>
					<DialogDescription>
						The text below becomes a named section under the initial scope. Trim
						it first if only part of the request is accepted.
					</DialogDescription>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
					<div className="flex flex-col gap-1">
						<label
							htmlFor="accept-scope-title"
							className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
						>
							Section title
						</label>
						<Input
							id="accept-scope-title"
							autoFocus
							value={title}
							maxLength={MILESTONE_TITLE_MAX}
							onChange={(event) => setTitle(event.target.value)}
							aria-invalid={error !== null && trimmedTitle.length === 0}
						/>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							Accepted scope
						</span>
						<div className="border border-app-border bg-app-panel">
							<CommentEditor
								initialValue={request.body}
								onChange={(value) => {
									bodyRef.current = value;
								}}
								onSubmit={() => void submit()}
								ariaLabel="Accepted scope"
								placeholder="Describe the accepted work."
								organizationId={organizationId}
								organizationSlug={orgSlug}
								minHeightClass="min-h-40"
								readOnly={pending}
							/>
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<label
							htmlFor="accept-scope-note"
							className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
						>
							Decision note (optional)
						</label>
						<Textarea
							id="accept-scope-note"
							value={note}
							maxLength={MILESTONE_NOTE_MAX}
							placeholder="For example: accepted in full, or trimmed the extras."
							onChange={(event) => setNote(event.target.value)}
						/>
					</div>
				</div>

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
					<Button
						loading={pending}
						isDisabled={trimmedTitle.length === 0}
						onPress={() => void submit()}
					>
						Accept into scope
					</Button>
				</DialogFooter>
			</div>
		</Dialog>
	);
}
