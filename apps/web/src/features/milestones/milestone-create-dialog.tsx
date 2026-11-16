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
	estimateHint,
	estimateInputValue,
	MILESTONE_NOTE_MAX,
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
	initialValues,
	submit,
	submitLabel = "Create milestone",
	dialogTitle = "New milestone",
	dialogDescription = "Define the outcome now. Everything except the title can be changed later.",
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	members: AssignableMember[];
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onCreated: (milestone: MilestoneDetail) => void;
	/** Prefilled values, used when a change request is turned into a milestone. */
	initialValues?: {
		title?: string;
		description?: unknown[];
		status?: MilestoneStatus;
		statusNote?: string | null;
		startDate?: string | null;
		dueDate?: string | null;
		estimateMinutes?: number | null;
		assigneeUserIds?: string[];
	};
	/**
	 * Replaces the create call. The move flow supplies its own endpoint so the
	 * request is marked moved in the same transaction as the milestone insert.
	 */
	submit?: (input: {
		title: string;
		description?: unknown[];
		status: MilestoneStatus;
		statusNote?: string;
		startDate: string | null;
		dueDate: string | null;
		estimateMinutes: number | null;
		assigneeUserIds: string[];
	}) => Promise<{ milestone: MilestoneDetail }>;
	submitLabel?: string;
	dialogTitle?: string;
	dialogDescription?: string;
}) {
	const create = useCreateMilestone(orgSlug, projectId);

	const [title, setTitle] = useState(initialValues?.title ?? "");
	const [status, setStatus] = useState<MilestoneStatus>(
		initialValues?.status ?? "todo",
	);
	const [dates, setDates] = useState<{
		startDate: string | null;
		dueDate: string | null;
	}>({
		startDate: normalizeDay(initialValues?.startDate),
		dueDate: normalizeDay(initialValues?.dueDate),
	});
	const [estimate, setEstimate] = useState(
		estimateInputValue(initialValues?.estimateMinutes ?? null),
	);
	const [assigneeIds, setAssigneeIds] = useState<string[]>(
		initialValues?.assigneeUserIds ?? [],
	);
	const [statusNote, setStatusNote] = useState(initialValues?.statusNote ?? "");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// A ref, not state: the editor emits on every keystroke and nothing in this
	// form renders the body, so re-rendering the dialog per character would be
	// pure cost.
	const descriptionRef = useRef<unknown[]>(initialValues?.description ?? []);

	// Live feedback for the estimate, so an unreadable value is caught before
	// the submit instead of turning into a failed request.
	const parsedEstimate = parseEstimateInput(estimate);
	const pending = submit ? submitting : create.isPending;
	// A blocked milestone needs a reason, on create as much as on update.
	const blockedNeedsNote =
		status === "blocked" && statusNote.trim().length === 0;

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

		if (blockedNeedsNote) {
			setError("Say why this milestone is blocked.");
			return;
		}

		setError(null);

		const input = {
			title: trimmed,
			status,
			...(status === "blocked" || status === "cancelled"
				? statusNote.trim()
					? { statusNote: statusNote.trim() }
					: {}
				: {}),
			startDate: normalizeDay(dates.startDate),
			dueDate: normalizeDay(dates.dueDate),
			estimateMinutes: parsedEstimate.minutes,
			assigneeUserIds: assigneeIds,
			...(descriptionRef.current.length > 0
				? { description: descriptionRef.current }
				: {}),
		};

		try {
			if (submit) {
				setSubmitting(true);
				const result = await submit(input);

				toast.success("Milestone created.");
				onCreated(result.milestone);
			} else {
				const result = await create.mutateAsync(input);

				toast.success("Milestone created.");
				onCreated(result.milestone);
			}

			onOpenChange(false);
		} catch (createError) {
			setError(
				createError instanceof Error
					? createError.message
					: "Could not create the milestone.",
			);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Dialog
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			isDismissable={!pending}
			showCloseButton={!pending}
			className="sm:max-w-2xl"
		>
			<form
				className="flex max-h-[75svh] flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<DialogHeader>
					<DialogTitle>{dialogTitle}</DialogTitle>
					<DialogDescription>{dialogDescription}</DialogDescription>
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
							{/*
							 * Live reading of what was typed, kept only when it adds
							 * something ("90" becomes "1h 30m"). The row stays mounted
							 * with a min height so the dialog does not jump while typing.
							 */}
							<p
								aria-live="polite"
								className={`min-h-4 text-xs ${
									parsedEstimate.ok ? "text-app-text-muted" : "text-danger"
								}`}
							>
								{parsedEstimate.ok
									? (estimateHint(estimate, parsedEstimate.minutes) ?? "")
									: parsedEstimate.message}
							</p>
						</div>
					</div>

					{/*
					 * Blocked and cancelled are the two statuses that accept a
					 * reason. Blocked requires one; cancelled is optional, so
					 * the same field serves both without forcing a sentence.
					 */}
					{(status === "blocked" || status === "cancelled") && (
						<div className="flex flex-col gap-1">
							<label
								htmlFor="new-milestone-status-note"
								className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase"
							>
								{status === "blocked"
									? "Why is it blocked?"
									: "Why is it cancelled? (optional)"}
							</label>
							<Input
								id="new-milestone-status-note"
								value={statusNote}
								maxLength={MILESTONE_NOTE_MAX}
								placeholder={
									status === "blocked"
										? "For example: waiting on the client's copy."
										: "For example: the client paused the project."
								}
								onChange={(event) => setStatusNote(event.target.value)}
								aria-invalid={blockedNeedsNote}
							/>
						</div>
					)}

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
								initialValue={initialValues?.description ?? []}
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
						isDisabled={pending}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						loading={pending}
						isDisabled={
							title.trim().length === 0 ||
							!parsedEstimate.ok ||
							blockedNeedsNote
						}
					>
						{submitLabel}
					</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}
