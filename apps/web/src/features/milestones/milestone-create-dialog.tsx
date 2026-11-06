"use client";

/**
 * Create a milestone.
 *
 * Why a dialog with every field instead of an inline title box: a milestone is
 * only useful once it has an owner, a schedule and a definition of done. An
 * inline composer produced empty rows that somebody had to reopen and complete.
 * The dialog captures the whole thing in one pass, and every field is optional
 * except the title, so it still stays fast for a quick note.
 *
 * The component is mounted only while it is open. That is deliberate: it gives
 * every open a fresh form and a fresh editor instance without a reset effect,
 * which is the usual source of stale text in create dialogs.
 *
 * Used by: milestone-list-panel.tsx.
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
import { useRef, useState } from "react";
import { toast } from "sonner";
import { MilestoneEditor } from "#/components/rich-text/milestone-editor";
import type { MilestoneDetail } from "./api";
import { useCreateMilestone } from "./hooks";
import {
	type AssignableMember,
	MilestoneAssigneeField,
} from "./milestone-assignee-field";
import { MilestoneDateRangeField } from "./milestone-date-range-field";
import { MilestoneEstimateInput } from "./milestone-estimate-input";
import { MilestoneStatusSelect } from "./milestone-status-select";
import {
	formatEstimate,
	MILESTONE_TITLE_MAX,
	type MilestoneStatus,
	normalizeDay,
	parseEstimateInput,
} from "./schema";

export function MilestoneCreateDialog({
	orgSlug,
	organizationId,
	projectId,
	members,
	isOpen,
	onOpenChange,
	onCreated,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	members: AssignableMember[];
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (milestone: MilestoneDetail) => void;
}) {
	const create = useCreateMilestone(orgSlug, projectId);

	const [title, setTitle] = useState("");
	const [status, setStatus] = useState<MilestoneStatus>("todo");
	const [dates, setDates] = useState<{
		startDate: string | null;
		dueDate: string | null;
	}>({ startDate: null, dueDate: null });
	const [estimate, setEstimate] = useState("");
	const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);

	// A ref, not state: the editor emits on every keystroke and nothing in this
	// form renders the body, so re-rendering the dialog per character would be
	// pure cost.
	const descriptionRef = useRef<unknown[]>([]);

	// Live feedback for the estimate, so an unreadable value is caught before
	// the submit instead of turning into a failed request.
	const parsedEstimate = parseEstimateInput(estimate);

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();

		const trimmed = title.trim();

		if (trimmed.length === 0) {
			setError("Give the milestone a title.");
			return;
		}

		if (!parsedEstimate.ok) {
			setError(parsedEstimate.message);
			return;
		}

		setError(null);

		try {
			const result = await create.mutateAsync({
				title: trimmed,
				status,
				startDate: normalizeDay(dates.startDate),
				dueDate: normalizeDay(dates.dueDate),
				estimateMinutes: parsedEstimate.minutes,
				assigneeUserIds: assigneeIds,
				...(descriptionRef.current.length > 0
					? { description: descriptionRef.current }
					: {}),
			});

			toast.success("Milestone created.");
			onCreated(result.milestone);
			onOpenChange(false);
		} catch (createError) {
			setError(
				createError instanceof Error
					? createError.message
					: "Could not create the milestone.",
			);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDismissable={!create.isPending}
			showCloseButton={!create.isPending}
			className="sm:max-w-2xl"
		>
			<form
				className="flex max-h-[75svh] flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<DialogHeader>
					<DialogTitle>New milestone</DialogTitle>
					<DialogDescription>
						Define the outcome now. Everything except the title can be changed
						later.
					</DialogDescription>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
					<div className="flex flex-col gap-1">
						<label
							htmlFor="new-milestone-title"
							className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
						>
							Title
						</label>
						<Input
							id="new-milestone-title"
							autoFocus
							value={title}
							maxLength={MILESTONE_TITLE_MAX}
							placeholder="What needs to be delivered?"
							onChange={(event) => setTitle(event.target.value)}
							aria-invalid={error !== null && title.trim().length === 0}
						/>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="flex flex-col gap-1">
							<span className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
								Status
							</span>
							<MilestoneStatusSelect status={status} onChange={setStatus} />
						</div>

						<div className="flex flex-col gap-1">
							<label
								htmlFor="new-milestone-estimate"
								className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
							>
								Estimate
							</label>
							<MilestoneEstimateInput
								value={estimate}
								onChange={setEstimate}
								invalid={!parsedEstimate.ok}
							/>
							<p
								className={
									parsedEstimate.ok
										? "text-xs text-app-text-muted"
										: "text-xs text-danger"
								}
							>
								{parsedEstimate.ok
									? parsedEstimate.minutes === null
										? "No estimate"
										: formatEstimate(parsedEstimate.minutes)
									: parsedEstimate.message}
							</p>
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							Dates
						</span>
						<MilestoneDateRangeField
							startDate={dates.startDate}
							dueDate={dates.dueDate}
							onChange={setDates}
						/>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							Assignees
						</span>
						<MilestoneAssigneeField
							members={members}
							selected={assigneeIds}
							assignees={[]}
							onChange={setAssigneeIds}
						/>
					</div>

					<div className="flex flex-col gap-1">
						<span className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							Details
						</span>
						<div className="border-y border-app-border">
							<MilestoneEditor
								initialValue={[]}
								onChange={(value) => {
									descriptionRef.current = value;
								}}
								ariaLabel="Milestone details"
								organizationId={organizationId}
								organizationSlug={orgSlug}
								projectId={projectId}
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
						isDisabled={create.isPending}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						loading={create.isPending}
						isDisabled={title.trim().length === 0 || !parsedEstimate.ok}
					>
						Create milestone
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
