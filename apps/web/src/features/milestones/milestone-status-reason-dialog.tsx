"use client";

/**
 * Ask why a milestone is blocked or cancelled.
 *
 * Why one dialog for both: the two transitions differ only in whether the
 * reason is required and in their copy. Keeping one component means the field,
 * the error and the keyboard behaviour cannot drift apart. Blocked requires a
 * sentence; cancelled accepts an optional note.
 *
 * Used by: milestone-detail-panel.tsx and milestone-list-panel.tsx.
 */

import { Button } from "@org/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@org/ui/components/dialog";
import { Textarea } from "@org/ui/components/textarea";
import { useEffect, useState } from "react";
import { MILESTONE_NOTE_MAX } from "./schema";

/** The two statuses that can carry a note. */
export type MilestoneReasonStatus = "blocked" | "cancelled";

/** Copy for each reason type. */
const COPY: Record<
	MilestoneReasonStatus,
	{
		description: string;
		label: string;
		placeholder: string;
		submit: string;
		error: string;
	}
> = {
	blocked: {
		description:
			"Explain what is stopping the work. The reason is shown on the timeline.",
		label: "Reason",
		placeholder: "For example: waiting on the API credentials.",
		submit: "Mark as blocked",
		error: "Say why this milestone is blocked.",
	},
	cancelled: {
		description:
			"Optionally say why this milestone is cancelled. The note is shown on the timeline.",
		label: "Reason (optional)",
		placeholder: "For example: the client paused the project.",
		submit: "Mark as cancelled",
		error: "The note is too long.",
	},
};

export function MilestoneStatusReasonDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	title,
	status,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (reason: string) => void;
	title: string;
	status: MilestoneReasonStatus;
}) {
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const copy = COPY[status];
	const required = status === "blocked";

	// A fresh prompt every time it opens, so an old reason is never submitted.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset for a new open
	useEffect(() => {
		setReason("");
		setError(null);
	}, [isOpen]);

	const trimmed = reason.trim();

	return (
		<Dialog isOpen={isOpen} onOpenChange={onOpenChange}>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();

					if (required && trimmed.length === 0) {
						setError(copy.error);
						return;
					}

					onConfirm(trimmed);
					onOpenChange(false);
				}}
			>
				<DialogHeader>
					<DialogTitle>
						{status === "blocked" ? "Block" : "Cancel"} {title}
					</DialogTitle>
					<DialogDescription>{copy.description}</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1">
					<label
						htmlFor="milestone-status-reason"
						className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
					>
						{copy.label}
					</label>
					<Textarea
						id="milestone-status-reason"
						autoFocus
						value={reason}
						maxLength={MILESTONE_NOTE_MAX}
						placeholder={copy.placeholder}
						onChange={(event) => setReason(event.target.value)}
						aria-invalid={error !== null}
					/>
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
					>
						Cancel
					</Button>
					<Button
						type="submit"
						variant={status === "cancelled" ? "outline" : "default"}
						isDisabled={required && trimmed.length === 0}
					>
						{copy.submit}
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
