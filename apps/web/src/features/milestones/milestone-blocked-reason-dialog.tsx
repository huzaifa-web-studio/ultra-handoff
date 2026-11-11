"use client";

/**
 * Ask why a milestone is blocked.
 *
 * Why a dialog: blocked is the one status that needs a sentence. The status
 * select stays a single action, and this prompt appears only for that
 * transition. The reason lands on the status activity row, where the next
 * reader will look.
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
import { Textarea } from "@org/ui/components/textarea";
import { useEffect, useState } from "react";
import { MILESTONE_NOTE_MAX } from "./schema";

export function MilestoneBlockedReasonDialog({
	isOpen,
	onOpenChange,
	onConfirm,
	title,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (reason: string) => void;
	title: string;
}) {
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);

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

					if (trimmed.length === 0) {
						setError("Say why this milestone is blocked.");
						return;
					}

					onConfirm(trimmed);
					onOpenChange(false);
				}}
			>
				<DialogHeader>
					<DialogTitle>Block {title}</DialogTitle>
					<DialogDescription>
						Explain what is stopping the work. The reason is shown on the
						timeline.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1">
					<label
						htmlFor="milestone-blocked-reason"
						className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
					>
						Reason
					</label>
					<Textarea
						id="milestone-blocked-reason"
						autoFocus
						value={reason}
						maxLength={MILESTONE_NOTE_MAX}
						placeholder="For example: waiting on the API credentials."
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
					<Button type="submit" isDisabled={trimmed.length === 0}>
						Mark as blocked
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
