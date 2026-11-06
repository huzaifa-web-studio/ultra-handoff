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
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@org/ui/components/tabs";
import { cn } from "cn";
import {
	AlertTriangleIcon,
	RefreshCwIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	MilestoneEditor,
	MilestoneEditorStatic,
} from "#/components/rich-text/milestone-editor";
import { UserAvatar } from "#/components/user-avatar";
import { useDebouncedCallback } from "#/hooks/use-debounced-callback";
import { formatRelativeTime } from "#/lib/date";
import type { MilestoneDetail, MilestoneViewer } from "./api";
import type { Comment } from "./comments/api";
import { CommentTab } from "./comments/comment-tab";
import { CommentThreadTab } from "./comments/comment-thread-tab";
import { useRealtimeComments } from "./comments/realtime";
import {
	commentTabsStorageKey,
	type OpenCommentTab,
	readCommentTabs,
	toOpenCommentTab,
	writeCommentTabs,
} from "./comments/tabs-storage";
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

/**
 * The sections of the milestone detail pane.
 *
 * The first two are fixed. Every additional key is a focused comment tab whose
 * id follows the `comment:` prefix.
 */
export type MilestoneTabKey = "overview" | "comments" | `comment:${string}`;

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
	selectedTab,
	onTabChange,
	onClose,
	onReload,
	onDeleted,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string | null;
	members: AssignableMember[];
	selectedTab: MilestoneTabKey;
	onTabChange: (tab: MilestoneTabKey) => void;
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
			selectedTab={selectedTab}
			onTabChange={onTabChange}
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
	selectedTab,
	onTabChange,
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
	selectedTab: MilestoneTabKey;
	onTabChange: (tab: MilestoneTabKey) => void;
	onClose?: () => void;
	onReload: () => void;
	onDeleted: () => void;
}) {
	const update = useUpdateMilestone(orgSlug, projectId);
	const setAssignees = useSetMilestoneAssignees(orgSlug, projectId);

	/*
	 * One subscription covers every comment surface of this milestone: the main
	 * list, the focused thread tabs and any thread cache that is still open.
	 * It patches the caches even while another tab is selected, so opening
	 * Comments after a remote post shows the current discussion.
	 */
	useRealtimeComments({
		orgSlug,
		projectId,
		milestoneId: milestone.id,
		viewerId: viewer.userId,
		locked: viewer.locked,
	});

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
	// The Comments panel is only mounted after its first visit. Once open it
	// stays mounted, so a draft and the list position survive a tab switch
	// without paying for an editor on every milestone that is only read.
	const [commentsOpened, setCommentsOpened] = useState(
		selectedTab === "comments",
	);

	// Focused comment tabs, persisted per milestone. The tab bar can grow to as
	// many as the reader opens; the list scrolls horizontally when it does.
	const commentTabsKey = commentTabsStorageKey(orgSlug, milestone.id);
	const [openCommentTabs, setOpenCommentTabs] = useState<OpenCommentTab[]>(() =>
		readCommentTabs(commentTabsKey),
	);
	// Trigger elements, so the selected tab can be revealed in the horizontal
	// tab strip when many focused tabs are open.
	const commentTabRefs = useRef(new Map<string, HTMLDivElement>());

	useEffect(() => {
		writeCommentTabs(commentTabsKey, openCommentTabs);
	}, [commentTabsKey, openCommentTabs]);

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

	// Remember the first visit so the panel is never torn down afterwards.
	useEffect(() => {
		if (selectedTab === "comments") setCommentsOpened(true);
	}, [selectedTab]);

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

	/** Open a focused tab for one root comment, or move to it if it exists. */
	function openCommentTab(comment: Comment) {
		const tab = toOpenCommentTab(comment);

		setOpenCommentTabs((current) => {
			const existing = current.some((item) => item.id === tab.id);

			if (existing) {
				// Keep the label fresh if the comment was edited since it opened.
				return current.map((item) =>
					item.id === tab.id
						? { ...item, label: tab.label, title: tab.title }
						: item,
				);
			}

			return [...current, tab];
		});

		onTabChange(`comment:${tab.id}`);
	}

	/** Close a focused tab and fall back to the full discussion if it was open. */
	function closeCommentTab(id: string) {
		setOpenCommentTabs((current) => current.filter((tab) => tab.id !== id));

		if (selectedTab === `comment:${id}`) {
			onTabChange("comments");
		}
	}

	// A stored tab can disappear if local storage was cleared. In that case the
	// URL falls back to the full discussion instead of showing an empty pane.
	const openTabKeys = new Set(
		openCommentTabs.map((tab) => `comment:${tab.id}`),
	);
	const effectiveSelectedTab: MilestoneTabKey =
		selectedTab === "overview" ||
		selectedTab === "comments" ||
		openTabKeys.has(selectedTab)
			? selectedTab
			: "comments";

	// Reveal the active comment tab when the strip is wider than the pane.
	useEffect(() => {
		if (!effectiveSelectedTab.startsWith("comment:")) return;

		commentTabRefs.current
			.get(effectiveSelectedTab)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [effectiveSelectedTab]);

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

			{/*
			 * Both panels are force mounted. Switching to Comments must not
			 * unmount the milestone editor, because its body save is debounced
			 * and an unmount would drop the last keystrokes. The inactive panel
			 * is marked inert by react-aria and hidden here.
			 */}
			<Tabs
				selectedKey={effectiveSelectedTab}
				onSelectionChange={(key) => {
					if (typeof key === "string") {
						onTabChange(key as MilestoneTabKey);
					}
				}}
				className="flex min-h-0 flex-1 flex-col gap-0"
			>
				<TabsList
					variant="line"
					aria-label="Milestone sections"
					className="w-full justify-start overflow-x-auto overflow-y-hidden border-b border-app-border px-2"
				>
					<TabsTrigger id="overview" className="flex-none cursor-pointer">
						Overview
					</TabsTrigger>
					<TabsTrigger id="comments" className="flex-none cursor-pointer">
						Comments
					</TabsTrigger>

					{/*
					 * Focused comment tabs. The first one carries a vertical rule
					 * that separates the fixed sections from the reader's own tabs.
					 * The list scrolls horizontally, so opening many stays usable.
					 */}
					{openCommentTabs.map((tab, index) => (
						<TabsTrigger
							key={tab.id}
							id={`comment:${tab.id}`}
							aria-label={tab.title}
							ref={(element) => {
								const key = `comment:${tab.id}`;

								if (element) {
									commentTabRefs.current.set(key, element);
								} else {
									commentTabRefs.current.delete(key);
								}
							}}
							className={cn(
								"max-w-48 flex-none cursor-pointer gap-1.5 pr-1.5 normal-case tracking-normal",
								index === 0 &&
									"ml-2 pl-3 before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-app-border before:content-['']",
							)}
						>
							<span className="min-w-0 truncate">{tab.label}</span>

							{/*
							 * A quick close on the tab itself. It stops the press from
							 * selecting the tab. It is a real focus stop so keyboard users
							 * can close a thread now that the pane no longer has its own
							 * Close tab bar.
							 */}
							<button
								type="button"
								aria-label={`Close ${tab.label}`}
								className="flex size-6 shrink-0 cursor-pointer items-center justify-center text-app-text-muted transition-colors hover:bg-app-panel-subtle hover:text-app-text"
								onPointerDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									closeCommentTab(tab.id);
								}}
							>
								<XIcon className="size-3.5" aria-hidden />
							</button>
						</TabsTrigger>
					))}
				</TabsList>

				<TabsContent
					id="overview"
					shouldForceMount
					className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
				>
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
											projectId={projectId}
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

					{/* Save state. A live region, so a screen reader hears the
					    result without the visual line having to move. */}
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
				</TabsContent>

				<TabsContent
					id="comments"
					shouldForceMount
					className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
				>
					{commentsOpened && (
						<CommentTab
							orgSlug={orgSlug}
							organizationId={organizationId}
							projectId={projectId}
							milestoneId={milestone.id}
							viewerId={viewer.userId}
							canComment={viewer.canComment}
							locked={viewer.locked}
							active={effectiveSelectedTab === "comments"}
							onOpenCommentTab={openCommentTab}
						/>
					)}
				</TabsContent>

				{openCommentTabs.map((tab) => (
					<TabsContent
						key={tab.id}
						id={`comment:${tab.id}`}
						shouldForceMount
						className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
					>
						<CommentThreadTab
							orgSlug={orgSlug}
							organizationId={organizationId}
							projectId={projectId}
							milestoneId={milestone.id}
							viewerId={viewer.userId}
							commentId={tab.id}
							canComment={viewer.canComment}
							locked={viewer.locked}
							active={effectiveSelectedTab === `comment:${tab.id}`}
							onClose={() => closeCommentTab(tab.id)}
						/>
					</TabsContent>
				))}
			</Tabs>

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
