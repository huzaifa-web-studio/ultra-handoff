"use client";

/**
 * Decline a change request.
 *
 * Why a dialog rather than an inline confirm: a decline needs a reason, and the
 * reason is what the client reads when they open the request later. The form is
 * deliberately small and the reason is required, mirroring the API rule.
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
import { Textarea } from "@org/ui/components/textarea";
import { useEffect, useState } from "react";
import { MILESTONE_NOTE_MAX } from "../schema";
import type { ChangeRequest } from "./api";
import { useDecideChangeRequest } from "./hooks";

export function ChangeRequestDeclineDialog({
	orgSlug,
	projectId,
	milestoneId,
	request,
	isOpen,
	onOpenChange,
	onDeclined,
}: {
	orgSlug: string;
	projectId: string;
	milestoneId: string;
	request: ChangeRequest | null;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onDeclined?: () => void;
}) {
	const decide = useDecideChangeRequest(orgSlug, projectId, milestoneId);
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);

	// Reset when the dialog opens for a different request.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset for a new request
	useEffect(() => {
		setNote("");
		setError(null);
	}, [request?.id]);

	const trimmed = note.trim();
	const canSubmit = trimmed.length > 0 && !decide.isPending;

	async function submit() {
		if (!request || !canSubmit) return;

		setError(null);

		try {
			await decide.mutateAsync({
				changeId: request.id,
				status: "declined",
				note: trimmed,
			});
			onOpenChange(false);
			onDeclined?.();
		} catch (submitError) {
			setError(
				submitError instanceof Error
					? submitError.message
					: "Could not decline the request.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDismissable={!decide.isPending}
			showCloseButton={!decide.isPending}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					void submit();
				}}
			>
				<DialogHeader>
					<DialogTitle>Decline change request</DialogTitle>
					<DialogDescription>
						Explain why this request is not being done. The client sees this
						reason on the request.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-1">
					<label
						htmlFor="change-request-decline-note"
						className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
					>
						Reason
					</label>
					<Textarea
						id="change-request-decline-note"
						value={note}
						maxLength={MILESTONE_NOTE_MAX}
						placeholder="For example: this is outside the agreed scope and needs its own milestone."
						onChange={(event) => setNote(event.target.value)}
						aria-invalid={error !== null && trimmed.length === 0}
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
						isDisabled={decide.isPending}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						variant="destructive"
						loading={decide.isPending}
						isDisabled={!canSubmit}
					>
						Decline request
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
