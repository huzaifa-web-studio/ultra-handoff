"use client";

/**
 * The milestone detail pane.
 *
 * Why split into two components: the outer one owns the query and its loading,
 * error and empty states. The inner one owns the draft state and only mounts
 * once a milestone is loaded, so its hooks never run against missing data.
 *
 * Autosave model:
 *   - the title and the body debounce, because they change on every keystroke
 *   - status, dates, estimate and assignees save immediately, because they are
 *     deliberate single actions and waiting for a debounce feels broken
 *   - every field group sends only what it changed, so a body save can never
 *     overwrite a status change made in another tab
 *
 * The pane is keyed by milestone id by its parent. Switching milestones
 * therefore remounts it, which resets the undo history and the draft state.
 *
 * Used by: milestone-page.tsx.
 */

import { Button } from "@org/ui/components/button";
import { Input } from "@org/ui/components/input";
import { ScrollArea } from "@org/ui/components/scroll-area";
import { cn } from "cn";
import {
	AlertTriangleIcon,
	RefreshCwIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { UserAvatar } from "#/components/user-avatar";
import { useDebouncedCallback } from "#/hooks/use-debounced-callback";
import { formatRelativeTime } from "#/lib/date";
import type { MilestoneDetail, MilestoneViewer } from "./api";
import {
	MilestoneEditor,
	MilestoneEditorStatic,
} from "./editor/milestone-editor";
import {
	useMilestoneDetail,
	useSetMilestoneAssignees,
	useUpdateMilestone,
} from "./hooks";
import {
	type AssignableMember,
	MilestoneAssigneeField,
} from "./milestone-assignee-field";
import { MilestoneDateRangeField } from "./milestone-date-range-field";
import { MilestoneDeleteDialog } from "./milestone-delete-dialog";
import { MilestoneEstimateField } from "./milestone-estimate-field";
import { MilestoneStatusBadge } from "./milestone-status-badge";
import { MilestoneStatusSelect } from "./milestone-status-select";
import {
	MILESTONE_TITLE_MAX,
	type MilestoneStatus,
	normalizeDay,
} from "./schema";

/** Save indicator states. */
type SaveState = "idle" | "saving" | "saved" | "error";

/** A small labelled cell in the metadata grid. */
function MetaField({
	label,
	className,
	children,
}: {
	label: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("flex flex-col gap-1", className)}>
			<span className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
				{label}
			</span>
			{children}
		</div>
	);
}

/**
 * The pane with the query states folded in.
 *
 * `onReload` remounts the content through the parent's key, which is the only
 * reliable way to discard an editor that holds a draft and an undo history.
 */
export function MilestoneDetailPanel({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	members,
	onClose,
	onReload,
	onDeleted,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string | null;
	members: AssignableMember[];
	onClose?: () => void;
	onReload: () => void;
	onDeleted: () => void;
}) {
	const query = useMilestoneDetail(orgSlug, projectId, milestoneId);

	if (!milestoneId) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 border border-app-border bg-app-panel p-8 text-center">
				<p className="text-sm font-medium text-app-text">Select a milestone</p>
				<p className="max-w-xs text-xs text-app-text-muted">
					Pick one from the list to read its details, change its dates or update
					progress.
				</p>
			</div>
		);
	}

	if (query.isPending) {
		return (
			<div className="flex h-full flex-col border border-app-border bg-app-panel">
				<div className="h-24 animate-pulse border-b border-app-border bg-app-panel-subtle" />
				<div className="grid gap-4 p-4 sm:grid-cols-2">
					{["status", "estimate", "dates", "assignees"].map((field) => (
						<div
							key={field}
							className="h-14 animate-pulse bg-app-panel-subtle"
						/>
					))}
				</div>
			</div>
		);
	}

	if (query.isError || !query.data) {
		return (
			<div className="flex h-full flex-col justify-center gap-3 border border-app-border bg-app-panel p-6">
				<p role="alert" className="text-sm text-danger">
					{query.error instanceof Error
						? query.error.message
						: "Could not load the milestone."}
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						onPress={() => void query.refetch()}
					>
						<RefreshCwIcon aria-hidden />
						Try again
					</Button>
					{onClose && (
						<Button variant="ghost" size="sm" onPress={onClose}>
							Back to the list
						</Button>
					)}
				</div>
			</div>
		);
	}

	return (
		<MilestoneDetailContent
			orgSlug={orgSlug}
			organizationId={organizationId}
			projectId={projectId}
			milestone={query.data.milestone}
			viewer={query.data.viewer}
			members={members}
			onClose={onClose}
			onReload={onReload}
			onDeleted={onDeleted}
		/>
	);
}

/** The loaded detail pane. */
function MilestoneDetailContent({
	orgSlug,
	organizationId,
	projectId,
	milestone,
	viewer,
	members,
	onClose,
	onReload,
	onDeleted,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestone: MilestoneDetail;
	viewer: MilestoneViewer;
	members: AssignableMember[];
	onClose?: () => void;
	onReload: () => void;
	onDeleted: () => void;
}) {
	const update = useUpdateMilestone(orgSlug, projectId);
	const setAssignees = useSetMilestoneAssignees(orgSlug, projectId);

	const [title, setTitle] = useState(milestone.title);
	const [status, setStatus] = useState<MilestoneStatus>(milestone.status);
	const [dates, setDates] = useState(() => ({
		startDate: normalizeDay(milestone.startDate),
		dueDate: normalizeDay(milestone.dueDate),
	}));
	const [assigneeIds, setAssigneeIds] = useState(
		milestone.assignees.map((assignee) => assignee.userId),
	);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveError, setSaveError] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [externalUpdate, setExternalUpdate] = useState(false);

	const retryRef = useRef<(() => Promise<unknown>) | null>(null);
	const lastSeenVersion = useRef(milestone.updatedAt);
	const lastSavedTitle = useRef(milestone.title);
	const lastSavedBody = useRef(JSON.stringify(milestone.description));

	const canWrite = viewer.canWrite;

	// Detect a change made by somebody else. The author of the latest write is
	// the only reliable signal, because a refetch and our own save both bump
	// `updatedAt`.
	useEffect(() => {
		if (milestone.updatedAt === lastSeenVersion.current) return;

		lastSeenVersion.current = milestone.updatedAt;

		if (milestone.updatedBy && milestone.updatedBy !== viewer.userId) {
			setExternalUpdate(true);
		}
	}, [milestone.updatedAt, milestone.updatedBy, viewer.userId]);

	/**
	 * Run one save and keep the indicator honest.
	 *
	 * Returns whether it succeeded so a caller can roll its optimistic value
	 * back. Failures are kept as an inline retry rather than a toast, because
	 * autosave can fail repeatedly and a toast per keystroke would be hostile.
	 */
	async function save(task: () => Promise<unknown>) {
		setSaveState("saving");
		setSaveError(null);

		try {
			await task();
			retryRef.current = null;
			setSaveState("saved");

			return true;
		} catch (error) {
			retryRef.current = task;
			setSaveState("error");
			setSaveError(
				error instanceof Error
					? error.message
					: "Could not save the milestone.",
			);

			return false;
		}
	}

	const saveTitle = useDebouncedCallback((value: string) => {
		const next = value.trim();

		if (next.length === 0 || next === lastSavedTitle.current) return;

		lastSavedTitle.current = next;
		void save(() =>
			update.mutateAsync({
				milestoneId: milestone.id,
				patch: { title: next },
			}),
		);
	}, 600);

	const saveBody = useDebouncedCallback((value: unknown[]) => {
		const serialized = JSON.stringify(value);

		if (serialized === lastSavedBody.current) return;

		lastSavedBody.current = serialized;
		void save(() =>
			update.mutateAsync({
				milestoneId: milestone.id,
				patch: { description: value },
			}),
		);
	}, 800);

	function changeStatus(next: MilestoneStatus) {
		const previous = status;
		setStatus(next);

		void save(() =>
			update.mutateAsync({
				milestoneId: milestone.id,
				patch: { status: next },
			}),
		).then((ok) => {
			if (!ok) setStatus(previous);
		});
	}

	function changeDates(next: {
		startDate: string | null;
		dueDate: string | null;
	}) {
		// Normalise once here so the local state and the PATCH body are always
		// day strings, even if the field ever hands back a date object.
		const normalized = {
			startDate: normalizeDay(next.startDate),
			dueDate: normalizeDay(next.dueDate),
		};
		const previous = dates;

		setDates(normalized);

		void save(() =>
			update.mutateAsync({
				milestoneId: milestone.id,
				patch: normalized,
			}),
		).then((ok) => {
			if (!ok) setDates(previous);
		});
	}

	function changeAssignees(next: string[]) {
		const previous = assigneeIds;
		setAssigneeIds(next);

		void save(() =>
			setAssignees.mutateAsync({ milestoneId: milestone.id, userIds: next }),
		).then((ok) => {
			if (!ok) setAssigneeIds(previous);
		});
	}

	function changeEstimate(minutes: number | null) {
		void save(() =>
			update.mutateAsync({
				milestoneId: milestone.id,
				patch: { estimateMinutes: minutes },
			}),
		);
	}

	async function retryFailedSave() {
		const task = retryRef.current;
		if (!task) return;

		await save(task);
	}

	return (
		<section className="flex h-full min-h-0 flex-col border border-app-border bg-app-panel">
			{/* Header */}
			<header className="flex items-start gap-2 border-b border-app-border p-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					{canWrite ? (
						<Input
							value={title}
							maxLength={MILESTONE_TITLE_MAX}
							aria-label="Milestone title"
							onChange={(event) => {
								setTitle(event.target.value);
								saveTitle.schedule(event.target.value);
							}}
							onBlur={() => {
								// An empty title is never saved, so the field must snap
								// back instead of showing a value the server does not have.
								if (title.trim().length === 0) {
									setTitle(lastSavedTitle.current);
									return;
								}

								saveTitle.flush();
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									saveTitle.flush();
								}
							}}
							className="h-auto border-b-transparent px-0 py-0 font-display text-xl font-bold tracking-normal normal-case focus-visible:border-b-app-focus"
						/>
					) : (
						<h2 className="font-display text-xl font-bold text-app-text">
							{milestone.title}
						</h2>
					)}

					<div className="flex flex-wrap items-center gap-2 text-xs text-app-text-muted">
						<MilestoneStatusBadge status={status} />
						{milestone.updatedByName && (
							<span>
								Edited {formatRelativeTime(milestone.updatedAt)} by{" "}
								{milestone.updatedByName}
							</span>
						)}
						{milestone.completedAt && (
							<span>Completed {formatRelativeTime(milestone.completedAt)}</span>
						)}
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-1">
					{canWrite && (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Delete milestone"
							onPress={() => setDeleteOpen(true)}
						>
							<Trash2Icon aria-hidden />
						</Button>
					)}
					{onClose && (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Close milestone details"
							onPress={onClose}
						>
							<XIcon aria-hidden />
						</Button>
					)}
				</div>
			</header>

			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-6 p-4">
					{externalUpdate && (
						<div
							aria-live="polite"
							className="flex flex-wrap items-center gap-2 border border-warning bg-warning-bg p-3 text-xs text-warning"
						>
							<AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
							<span className="flex-1">
								Someone else updated this milestone while you had it open.
							</span>
							<Button size="xs" variant="surface" onPress={onReload}>
								Reload
							</Button>
						</div>
					)}

					{/* Metadata */}
					<div className="grid gap-4 sm:grid-cols-2">
						<MetaField label="Status">
							<MilestoneStatusSelect
								status={status}
								onChange={changeStatus}
								readOnly={!canWrite}
							/>
						</MetaField>

						<MetaField label="Estimate">
							<MilestoneEstimateField
								minutes={milestone.estimateMinutes}
								onCommit={changeEstimate}
								readOnly={!canWrite}
							/>
						</MetaField>

						<MetaField label="Dates" className="sm:col-span-2">
							<MilestoneDateRangeField
								startDate={dates.startDate}
								dueDate={dates.dueDate}
								onChange={changeDates}
								readOnly={!canWrite}
							/>
						</MetaField>

						<MetaField label="Assignees" className="sm:col-span-2">
							<MilestoneAssigneeField
								members={members}
								selected={assigneeIds}
								assignees={milestone.assignees}
								onChange={changeAssignees}
								readOnly={!canWrite}
							/>
						</MetaField>
					</div>

					{/* Body */}
					<section className="flex flex-col gap-2">
						<h3 className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							Details
						</h3>

						<div className="border-y border-app-border">
							{canWrite ? (
								<MilestoneEditor
									key={milestone.id}
									initialValue={milestone.description}
									onChange={(value) => saveBody.schedule(value)}
									ariaLabel="Milestone details"
									organizationId={organizationId}
									organizationSlug={orgSlug}
								/>
							) : milestone.description.length > 0 ? (
								<MilestoneEditorStatic
									value={milestone.description}
									ariaLabel="Milestone details"
									organizationSlug={orgSlug}
								/>
							) : (
								<p className="p-3 text-sm text-app-text-muted">
									No details yet.
								</p>
							)}
						</div>
					</section>

					{/* Authorship */}
					<div className="flex flex-wrap items-center gap-2 text-xs text-app-text-muted">
						{milestone.createdByName && (
							<>
								<UserAvatar
									size="sm"
									name={milestone.createdByName}
									className="size-5"
								/>
								<span>Created by {milestone.createdByName}</span>
							</>
						)}
					</div>
				</div>
			</ScrollArea>

			{/* Save state. A live region, so a screen reader hears the result
			    without the visual line having to move. */}
			<div className="flex min-h-9 items-center justify-between gap-2 border-t border-app-border px-4 py-1.5 text-xs">
				<span
					aria-live="polite"
					className={cn(
						saveState === "error" ? "text-danger" : "text-app-text-muted",
					)}
				>
					{saveState === "saving" && "Saving..."}
					{saveState === "saved" && "Saved"}
					{saveState === "error" && (saveError ?? "Could not save.")}
				</span>

				{saveState === "error" && retryRef.current && (
					<Button
						size="xs"
						variant="outline"
						onPress={() => void retryFailedSave()}
					>
						Retry
					</Button>
				)}
			</div>

			{canWrite && (
				<MilestoneDeleteDialog
					orgSlug={orgSlug}
					projectId={projectId}
					milestoneId={milestone.id}
					title={milestone.title}
					isOpen={deleteOpen}
					onOpenChange={setDeleteOpen}
					onDeleted={onDeleted}
				/>
			)}
		</section>
	);
}
