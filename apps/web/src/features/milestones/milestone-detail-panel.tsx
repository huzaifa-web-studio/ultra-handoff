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
	LockIcon,
	LockOpenIcon,
	RefreshCwIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "#/components/user-avatar";
import { useRealtimeEvent } from "#/features/realtime/provider";
import { useDebouncedCallback } from "#/hooks/use-debounced-callback";
import { formatDate, formatRelativeTime } from "#/lib/date";
import type {
	MilestoneDetail,
	MilestoneScopeEntrySummary,
	MilestoneViewer,
} from "./api";
import { ChangesTab } from "./changes/changes-tab";
import { OverviewChanges } from "./changes/overview-changes";
import { useRealtimeChangeRequests } from "./changes/realtime";
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
	useSetMilestoneLock,
	useToggleMilestoneChecklist,
	useUpdateMilestone,
} from "./hooks";
import {
	type AssignableMember,
	MilestoneAssigneeField,
} from "./milestone-assignee-field";
import { MilestoneDateRangeField } from "./milestone-date-range-field";
import { MilestoneDeleteDialog } from "./milestone-delete-dialog";
import { MilestoneEstimateField } from "./milestone-estimate-field";
import { MilestonePhaseCard } from "./milestone-phase-card";
import { MilestoneStatusBadge } from "./milestone-status-badge";
import {
	type MilestoneReasonStatus,
	MilestoneStatusReasonDialog,
} from "./milestone-status-reason-dialog";
import { MilestoneStatusSelect } from "./milestone-status-select";
import { readMilestonePayload, useRealtimeScopeEntries } from "./realtime";
import {
	MILESTONE_TITLE_MAX,
	type MilestoneStatus,
	normalizeDay,
} from "./schema";
import { BaselineScopeTab } from "./scope/baseline-scope-tab";
import { canWriteScopeEntry, isCurrentScopeEntry } from "./scope/permissions";
import { ScopeEntryTab } from "./scope/scope-entry-tab";
import { ScopeIndexRow } from "./scope/scope-index-row";
import { ScopeTab } from "./scope/scope-tab";
import {
	baselineScopeTab,
	type OpenScopeTab,
	pruneScopeTabs,
	readScopeTabs,
	scopeTabsEqual,
	scopeTabsStorageKey,
	toOpenScopeTab,
	writeScopeTabs,
} from "./scope/tabs-storage";
import {
	BASELINE_SCOPE_TAB_ID,
	commentTabKey,
	isScopeTabKey,
	type MilestoneTabKey,
	resolveMilestoneTab,
	scopeTabId,
	scopeTabKey,
} from "./tabs";

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
 * The save state as text, so it can sit in a footer or beside a hint without
 * repeating the same live region in two places.
 */
function SaveStateText({
	saveState,
	saveError,
	className,
}: {
	saveState: SaveState;
	saveError: string | null;
	className?: string;
}) {
	return (
		<span
			aria-live="polite"
			className={cn(
				saveState === "error" ? "text-danger" : "text-app-text-muted",
				className,
			)}
		>
			{saveState === "saving" && "Saving..."}
			{saveState === "saved" && "Saved"}
			{saveState === "error" && (saveError ?? "Could not save.")}
		</span>
	);
}

/**
 * The save indicator for the fields that autosave.
 *
 * Why its own component: the metadata form and the scope document both need it,
 * and repeating the live region in two tabs is how the two copies drift.
 */
function SaveStatus({
	saveState,
	saveError,
	onRetry,
}: {
	saveState: SaveState;
	saveError: string | null;
	onRetry: () => void;
}) {
	return (
		<div className="flex min-h-9 items-center justify-between gap-2 border-t border-app-border px-4 py-1.5 text-xs">
			<SaveStateText saveState={saveState} saveError={saveError} />

			{saveState === "error" && (
				<Button size="xs" variant="outline" onPress={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

/**
 * One reader opened tab in the strip.
 *
 * Why its own component: scope tabs and comment tabs share one strip, and two
 * copies of the close button is how the keyboard behaviour drifts. The first
 * reader tab carries the vertical rule that separates the fixed sections from
 * the reader's own tabs.
 */
function ReaderTabTrigger({
	tabKey,
	label,
	ariaLabel,
	first,
	onClose,
	registerRef,
}: {
	tabKey: string;
	label: string;
	ariaLabel?: string;
	first: boolean;
	onClose: () => void;
	registerRef: (element: HTMLDivElement | null) => void;
}) {
	return (
		<TabsTrigger
			id={tabKey}
			aria-label={ariaLabel}
			ref={registerRef}
			className={cn(
				"max-w-48 flex-none cursor-pointer gap-1.5 pr-1.5 normal-case tracking-normal",
				first &&
					"ml-2 pl-3 before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-app-border before:content-['']",
			)}
		>
			<span className="min-w-0 truncate">{label}</span>

			{/*
			 * A quick close on the tab itself. It stops the press from selecting
			 * the tab and stays a real focus stop so keyboard users can close a
			 * tab without leaving the strip.
			 */}
			<button
				type="button"
				aria-label={`Close ${label}`}
				className="flex size-6 shrink-0 cursor-pointer items-center justify-center text-app-text-muted transition-colors hover:bg-app-panel-subtle hover:text-app-text"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					onClose();
				}}
			>
				<XIcon className="size-3.5" aria-hidden />
			</button>
		</TabsTrigger>
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
	projectSlug,
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
	projectSlug: string;
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
			projectSlug={projectSlug}
			projectId={projectId}
			milestone={query.data.milestone}
			viewer={query.data.viewer}
			members={members}
			selectedTab={selectedTab}
			onTabChange={onTabChange}
			onClose={onClose}
			onReload={onReload}
			onRefetch={() => void query.refetch()}
			onDeleted={onDeleted}
		/>
	);
}

/** The loaded detail pane. */
function MilestoneDetailContent({
	orgSlug,
	organizationId,
	projectSlug,
	projectId,
	milestone,
	viewer,
	members,
	selectedTab,
	onTabChange,
	onClose,
	onReload,
	onRefetch,
	onDeleted,
}: {
	orgSlug: string;
	organizationId: string;
	projectSlug: string;
	projectId: string;
	milestone: MilestoneDetail;
	viewer: MilestoneViewer;
	members: AssignableMember[];
	selectedTab: MilestoneTabKey;
	onTabChange: (tab: MilestoneTabKey) => void;
	onClose?: () => void;
	onReload: () => void;
	/** Refetch in place, without remounting the editors. */
	onRefetch: () => void;
	onDeleted: () => void;
}) {
	const update = useUpdateMilestone(orgSlug, projectId);
	const setAssignees = useSetMilestoneAssignees(orgSlug, projectId);
	const setLock = useSetMilestoneLock(orgSlug, projectId);
	const toggleChecklist = useToggleMilestoneChecklist(orgSlug, projectId);

	/*
	 * A milestone lock is a separate flag from an archived project. The
	 * discussion only stops when the project is archived; the milestone lock
	 * leaves comments and change requests open.
	 */
	const locked = milestone.lockedAt !== null;
	const canEditFields = viewer.canWrite && !locked;
	// Status and assignees stay available to staff while the document is
	// locked. A client still cannot touch either.
	const canEditLifecycle = viewer.canWrite;
	// Defensive fallbacks: a tab that stayed open across a deploy can still hold
	// a detail cached before scope sections existed.
	const scopeEntries = milestone.scopeEntries ?? [];
	// The Overview shows the newest additions only. The full list is the Scope
	// tab's job, and every card opens its own focused tab.
	const latestScopeEntries = [...scopeEntries].slice(-3).reverse();

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
		archived: viewer.archived,
	});

	// One subscription for the Changes tab, so the open badge follows a
	// request raised or decided in another tab.
	useRealtimeChangeRequests({
		orgSlug,
		projectId,
		milestoneId: milestone.id,
	});

	// Scope sections are fetched lazily and by other people too, so this keeps
	// an open round current without refetching the whole milestone.
	useRealtimeScopeEntries({
		orgSlug,
		projectId,
		milestoneId: milestone.id,
		viewerId: viewer.userId,
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
	/*
	 * The initial scope draft lives here, not inside the editor, so closing the
	 * baseline tab keeps the text and its pending save alive. It is a ref on
	 * purpose: typing updates the editor and the save without re-rendering the
	 * whole detail pane on every keystroke.
	 */
	const scopeDraftRef = useRef<unknown[]>(milestone.description);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveError, setSaveError] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// The status reason prompt: blocked requires a note, cancelled does not.
	const [reasonStatus, setReasonStatus] =
		useState<MilestoneReasonStatus | null>(null);
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

	// Focused scope tabs follow the same contract: persisted per milestone,
	// identified by section id, and closed from the tab strip.
	const scopeTabsKey = scopeTabsStorageKey(orgSlug, milestone.id);
	const [openScopeTabs, setOpenScopeTabs] = useState<OpenScopeTab[]>(() =>
		readScopeTabs(scopeTabsKey),
	);

	// Trigger elements, so the selected tab can be revealed in the horizontal
	// tab strip when many focused tabs are open. Scope and comment tabs share
	// one map because they share one strip.
	const tabRefs = useRef(new Map<string, HTMLDivElement>());
	// A closed tab can still be named by the URL for one render while the
	// navigation lands, and the deep link effect would otherwise reopen it.
	const closedScopeTabIds = useRef(new Set<string>());

	useEffect(() => {
		writeCommentTabs(commentTabsKey, openCommentTabs);
	}, [commentTabsKey, openCommentTabs]);

	useEffect(() => {
		writeScopeTabs(scopeTabsKey, openScopeTabs);
	}, [scopeTabsKey, openScopeTabs]);

	/*
	 * Drop a stored tab whose section no longer exists and refresh the label
	 * and kind of the rest. The equality guard keeps a refetch from writing
	 * state on every render.
	 */
	useEffect(() => {
		setOpenScopeTabs((current) => {
			const next = pruneScopeTabs(current, scopeEntries);

			return scopeTabsEqual(current, next) ? current : next;
		});
	}, [scopeEntries]);

	/*
	 * A URL can name a scope this device has never opened, such as a link from
	 * another machine. The tab is derived below so the first paint is correct,
	 * and this effect adds it to the stored list once.
	 */
	const requestedScopeTabId = scopeTabId(selectedTab);
	const requestedScopeTab: OpenScopeTab | null = (() => {
		if (requestedScopeTabId === null) return null;
		if (requestedScopeTabId === BASELINE_SCOPE_TAB_ID) {
			return baselineScopeTab();
		}

		const entry = scopeEntries.find((item) => item.id === requestedScopeTabId);

		return entry ? toOpenScopeTab(entry) : null;
	})();
	const requestedScopeTabLabel = requestedScopeTab?.label ?? null;
	const requestedScopeTabKind = requestedScopeTab?.kind ?? null;

	useEffect(() => {
		if (
			requestedScopeTabId === null ||
			requestedScopeTabLabel === null ||
			requestedScopeTabKind === null
		) {
			return;
		}

		// A tab the reader just closed stays closed, even though the URL may
		// still name it until the navigation lands.
		if (closedScopeTabIds.current.has(requestedScopeTabId)) return;

		const tab: OpenScopeTab = {
			id: requestedScopeTabId,
			label: requestedScopeTabLabel,
			kind: requestedScopeTabKind,
		};

		setOpenScopeTabs((current) =>
			current.some((item) => item.id === tab.id) ? current : [...current, tab],
		);
	}, [requestedScopeTabId, requestedScopeTabLabel, requestedScopeTabKind]);

	// Everything the strip and the tab content render. A deep linked tab joins
	// the list before the effect above has stored it, so the first paint is not
	// an empty pane.
	const scopeTabs =
		requestedScopeTab &&
		!openScopeTabs.some((tab) => tab.id === requestedScopeTab.id)
			? [...openScopeTabs, requestedScopeTab]
			: openScopeTabs;

	const retryRef = useRef<(() => Promise<unknown>) | null>(null);
	const lastSavedTitle = useRef(milestone.title);
	const lastSavedBody = useRef(JSON.stringify(milestone.description));
	// The body the panel has already shown, so a refetch that brings somebody
	// else's text can raise the reload banner.
	const lastSeenDescription = useRef(JSON.stringify(milestone.description));
	// A remote title must not overwrite what the user is typing right now.
	const titleFocused = useRef(false);

	/*
	 * Only the rich text body is missing from the broadcast. Every other field
	 * is patched into the detail cache, so a remote change to one of those needs
	 * no reload prompt. This listener therefore watches the `changed` list, not
	 * `updatedAt`, which moves for any write.
	 */
	useRealtimeEvent((event) => {
		const payload = readMilestonePayload(event);

		if (!payload || payload.kind !== "updated") return;
		if (payload.milestone.id !== milestone.id) return;
		if (payload.milestone.updatedBy === viewer.userId) return;

		// A status change can open a new round and close the previous period.
		// Refetching in place updates the phase card and the scope sections
		// without remounting the editors.
		if (payload.changed.includes("status")) {
			onRefetch();
			return;
		}

		// A locked scope is rendered from a static copy of the body. A remote
		// tick changes that copy, so the pane reloads instead of showing a
		// checkbox that no longer matches the server.
		if (payload.changed.includes("checklist")) {
			onReload();
			return;
		}

		if (!payload.changed.includes("description")) return;

		setExternalUpdate(true);
	});

	// A refetch can deliver a body edited while the socket was down. Our own
	// save also changes the prop, so the author check keeps it quiet.
	useEffect(() => {
		const serialized = JSON.stringify(milestone.description);

		if (serialized === lastSeenDescription.current) return;

		lastSeenDescription.current = serialized;

		if (milestone.updatedBy && milestone.updatedBy !== viewer.userId) {
			setExternalUpdate(true);
		}
	}, [milestone.description, milestone.updatedBy, viewer.userId]);

	/*
	 * Keep the editable controls in step with the cache. They hold local state
	 * so a save can be optimistic and rolled back, so a remote change has to be
	 * pushed back into that state. The body is excluded on purpose: the editor
	 * owns its draft and the banner above handles a conflict.
	 */
	useEffect(() => {
		if (!titleFocused.current) setTitle(milestone.title);
	}, [milestone.title]);

	useEffect(() => {
		setStatus(milestone.status);
	}, [milestone.status]);

	useEffect(() => {
		setDates({
			startDate: normalizeDay(milestone.startDate),
			dueDate: normalizeDay(milestone.dueDate),
		});
	}, [milestone.startDate, milestone.dueDate]);

	useEffect(() => {
		setAssigneeIds(milestone.assignees.map((assignee) => assignee.userId));
	}, [milestone.assignees]);

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

	/**
	 * Keep the shared draft and schedule the autosave.
	 *
	 * The baseline tab is the only editor for the initial scope, and it calls
	 * this. The draft is a ref, so a keystroke does not re-render the rest of
	 * the pane, and closing the tab cannot lose text that has not been sent.
	 */
	function changeScope(value: unknown[]) {
		scopeDraftRef.current = value;
		saveBody.schedule(value);
	}

	function changeStatus(next: MilestoneStatus) {
		// Blocked and cancelled are the two transitions that offer a reason.
		// Blocked requires it, cancelled accepts an empty note.
		if ((next === "blocked" || next === "cancelled") && status !== next) {
			setReasonStatus(next);
			return;
		}

		persistStatus(next);
	}

	function persistStatus(next: MilestoneStatus, statusNote?: string) {
		const previous = status;
		setStatus(next);

		void save(() =>
			update.mutateAsync({
				milestoneId: milestone.id,
				patch: {
					status: next,
					...(statusNote ? { statusNote } : {}),
				},
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

	/** Lock or unlock the milestone. The cache is patched by the mutation. */
	function toggleLock() {
		setLock.mutate({ milestoneId: milestone.id, locked: !locked });
	}

	/** Tick a scope item while the milestone is locked. */
	async function toggleScopeChecklistItem(
		itemId: string,
		checked: boolean,
	): Promise<void> {
		await toggleChecklist.mutateAsync({
			milestoneId: milestone.id,
			itemId,
			checked,
		});
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

		onTabChange(commentTabKey(tab.id));
	}

	/** Close a focused comment tab and fall back to the full discussion. */
	function closeCommentTab(id: string) {
		setOpenCommentTabs((current) => current.filter((tab) => tab.id !== id));

		if (selectedTab === commentTabKey(id)) {
			onTabChange("comments");
		}
	}

	/** Open a focused tab for one scope section, or focus the open one. */
	function openScopeTab(tab: OpenScopeTab) {
		// A deliberate open overrides an earlier close.
		closedScopeTabIds.current.delete(tab.id);

		setOpenScopeTabs((current) =>
			current.some((item) => item.id === tab.id)
				? current.map((item) => (item.id === tab.id ? tab : item))
				: [...current, tab],
		);

		onTabChange(scopeTabKey(tab.id));
	}

	function openBaselineScopeTab() {
		openScopeTab(baselineScopeTab());
	}

	function openEntryScopeTab(entry: MilestoneScopeEntrySummary) {
		openScopeTab(toOpenScopeTab(entry));
	}

	/** Close a focused scope tab and fall back to the Scope index. */
	function closeScopeTab(id: string) {
		closedScopeTabIds.current.add(id);
		setOpenScopeTabs((current) => current.filter((tab) => tab.id !== id));

		if (selectedTab === scopeTabKey(id)) {
			onTabChange("scope");
		}
	}

	// A stored tab can disappear if local storage was cleared, and a URL can
	// name a tab this device never opened. Both resolve to a real parent tab
	// instead of an empty pane, and a deep linked scope stays selected while
	// the effect above stores it.
	const openTabKeys = new Set<MilestoneTabKey>([
		...scopeTabs.map((tab) => scopeTabKey(tab.id)),
		...openCommentTabs.map((tab) => commentTabKey(tab.id)),
	]);
	const openDeepLinkedScope =
		isScopeTabKey(selectedTab) && requestedScopeTab !== null;
	const effectiveSelectedTab: MilestoneTabKey = openDeepLinkedScope
		? selectedTab
		: resolveMilestoneTab(selectedTab, openTabKeys);

	/*
	 * Reveal the selected reader tab when the strip is wider than the pane.
	 * Scope and comment tabs share one strip, so both use the same map.
	 */
	useEffect(() => {
		if (
			effectiveSelectedTab === "overview" ||
			effectiveSelectedTab === "scope" ||
			effectiveSelectedTab === "changes" ||
			effectiveSelectedTab === "comments"
		) {
			return;
		}

		tabRefs.current
			.get(effectiveSelectedTab)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [effectiveSelectedTab]);

	return (
		<section className="flex h-full min-h-0 flex-col border border-app-border bg-app-panel">
			{/* Header */}
			<header className="flex items-start gap-2 border-b border-app-border p-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					{canEditFields ? (
						<Input
							value={title}
							maxLength={MILESTONE_TITLE_MAX}
							aria-label="Milestone title"
							onChange={(event) => {
								setTitle(event.target.value);
								saveTitle.schedule(event.target.value);
							}}
							onFocus={() => {
								titleFocused.current = true;
							}}
							onBlur={() => {
								titleFocused.current = false;

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
						{locked && (
							<span className="inline-flex items-center gap-1 bg-app-selected px-1.5 py-0.5 font-semibold text-app-text uppercase tracking-widest text-[0.6rem]">
								<LockIcon className="size-3" aria-hidden />
								Locked
							</span>
						)}
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
					{viewer.canLock && (
						<Button
							variant="ghost"
							size="sm"
							loading={setLock.isPending}
							onPress={toggleLock}
						>
							{locked ? <LockOpenIcon aria-hidden /> : <LockIcon aria-hidden />}
							{locked ? "Unlock" : "Lock"}
						</Button>
					)}
					{canEditFields && (
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

			{locked && (
				<div className="flex flex-wrap items-center gap-2 border-b border-warning bg-warning-bg px-4 py-2 text-xs text-warning">
					<LockIcon className="size-3.5 shrink-0" aria-hidden />
					<span>
						Locked by {milestone.lockedByName ?? "an owner"} on{" "}
						{formatDate(milestone.lockedAt ?? milestone.updatedAt)}. The initial
						scope, title, dates and estimate are read-only. Status, assignees,
						checklist progress and active phase notes can still change, and a
						change request can still be accepted into a new section.
					</span>
				</div>
			)}

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
					<TabsTrigger id="scope" className="flex-none cursor-pointer">
						Scope
					</TabsTrigger>
					<TabsTrigger
						id="changes"
						className="flex-none cursor-pointer gap-1.5"
					>
						Changes
						{milestone.openChangeRequestCount > 0 && (
							<span className="bg-app-selected px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-text">
								{milestone.openChangeRequestCount}
							</span>
						)}
					</TabsTrigger>
					<TabsTrigger id="comments" className="flex-none cursor-pointer">
						Comments
					</TabsTrigger>

					{/*
					 * Reader opened tabs. Scope tabs come first, then focused
					 * discussions, so the strip groups by what the tab shows. The
					 * first one carries the vertical rule that separates the fixed
					 * sections from the reader's own tabs. The list scrolls
					 * horizontally, so opening many stays usable.
					 */}
					{scopeTabs.map((tab, index) => {
						const key = scopeTabKey(tab.id);

						return (
							<ReaderTabTrigger
								key={key}
								tabKey={key}
								label={tab.label}
								ariaLabel={tab.label}
								first={index === 0}
								onClose={() => closeScopeTab(tab.id)}
								registerRef={(element) => {
									if (element) {
										tabRefs.current.set(key, element);
									} else {
										tabRefs.current.delete(key);
									}
								}}
							/>
						);
					})}

					{openCommentTabs.map((tab, index) => {
						const key = commentTabKey(tab.id);

						return (
							<ReaderTabTrigger
								key={key}
								tabKey={key}
								label={tab.label}
								ariaLabel={tab.title}
								first={scopeTabs.length === 0 && index === 0}
								onClose={() => closeCommentTab(tab.id)}
								registerRef={(element) => {
									if (element) {
										tabRefs.current.set(key, element);
									} else {
										tabRefs.current.delete(key);
									}
								}}
							/>
						);
					})}
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
										Someone else edited the milestone details. Reload to see
										their changes.
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
										readOnly={!canEditLifecycle}
									/>
								</MetaField>

								<MetaField label="Estimate">
									<MilestoneEstimateField
										minutes={milestone.estimateMinutes}
										onCommit={changeEstimate}
										readOnly={!canEditFields}
									/>
								</MetaField>

								<MetaField label="Dates" className="sm:col-span-2">
									<MilestoneDateRangeField
										startDate={dates.startDate}
										dueDate={dates.dueDate}
										onChange={changeDates}
										readOnly={!canEditFields}
									/>
								</MetaField>

								<MetaField label="Assignees" className="sm:col-span-2">
									<MilestoneAssigneeField
										members={members}
										selected={assigneeIds}
										assignees={milestone.assignees}
										onChange={changeAssignees}
										readOnly={!canEditLifecycle}
									/>
								</MetaField>
							</div>

							{/*
							 * Scope summary. No document is rendered here: every card
							 * opens its own tab, where the section gets the full pane.
							 */}
							<section className="flex flex-col gap-2">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<h3 className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
										Scope
										{scopeEntries.length > 0 && (
											<span className="ml-2 bg-app-selected px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-app-text">
												{scopeEntries.length} added
											</span>
										)}
									</h3>
									<Button
										size="xs"
										variant="outline"
										onPress={() => onTabChange("scope")}
									>
										Open scope
									</Button>
								</div>

								<ScopeIndexRow
									kind="baseline"
									title="Initial scope"
									meta={
										locked
											? "Locked baseline"
											: milestone.description.length === 0
												? "No scope written yet."
												: "The agreed baseline"
									}
									onOpen={openBaselineScopeTab}
								/>

								{latestScopeEntries.map((entry) => (
									<ScopeIndexRow
										key={entry.id}
										kind={entry.kind}
										title={entry.title}
										meta={`${entry.createdByName ?? "Former member"} · ${formatDate(
											entry.createdAt,
										)}`}
										badge={
											isCurrentScopeEntry(
												entry,
												milestone.phase?.currentPeriodId ?? null,
											)
												? "Current"
												: undefined
										}
										onOpen={() => openEntryScopeTab(entry)}
									/>
								))}

								{scopeEntries.length > latestScopeEntries.length && (
									<Button
										size="xs"
										variant="ghost"
										className="self-start"
										onPress={() => onTabChange("scope")}
									>
										View all {scopeEntries.length} additions
									</Button>
								)}
							</section>

							{/* Changes summary. Every request is a card, and the tab holds the detail. */}
							<section className="flex flex-col gap-2">
								<div className="flex items-center justify-between gap-2">
									<h3 className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
										Changes
										{milestone.openChangeRequestCount > 0 && (
											<span className="ml-2 bg-info-bg px-1.5 py-0.5 text-[0.6rem] font-semibold tabular-nums text-info">
												{milestone.openChangeRequestCount} open
											</span>
										)}
									</h3>
									<Button
										size="xs"
										variant="outline"
										onPress={() => onTabChange("changes")}
									>
										Open changes
									</Button>
								</div>

								<OverviewChanges
									orgSlug={orgSlug}
									projectId={projectId}
									milestoneId={milestone.id}
									active={effectiveSelectedTab === "overview"}
									onOpen={() => onTabChange("changes")}
								/>
							</section>

							{/* Phase timing. Hidden until the backfill or a transition gives it data. */}
							{milestone.phase && (
								<MilestonePhaseCard phase={milestone.phase} />
							)}

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

					<SaveStatus
						saveState={saveState}
						saveError={saveError}
						onRetry={() => void retryFailedSave()}
					/>
				</TabsContent>

				<TabsContent
					id="scope"
					shouldForceMount
					className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
				>
					{effectiveSelectedTab === "scope" && (
						<ScopeTab
							milestone={milestone}
							phase={milestone.phase}
							viewer={viewer}
							locked={locked}
							canEditFields={canEditFields}
							onOpenBaseline={openBaselineScopeTab}
							onOpenEntry={openEntryScopeTab}
						/>
					)}
				</TabsContent>

				<TabsContent
					id="changes"
					shouldForceMount
					className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
				>
					<ChangesTab
						orgSlug={orgSlug}
						organizationId={organizationId}
						projectSlug={projectSlug}
						projectId={projectId}
						milestoneId={milestone.id}
						archived={viewer.archived}
						canCreate={viewer.canComment}
						canDecide={viewer.canWrite}
						members={members}
						active={effectiveSelectedTab === "changes"}
						onOpenScope={(scopeEntryId) => {
							if (!scopeEntryId) {
								onTabChange("scope");
								return;
							}

							const entry = scopeEntries.find(
								(item) => item.id === scopeEntryId,
							);

							if (entry) openEntryScopeTab(entry);
							else onTabChange("scope");
						}}
					/>
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
							archived={viewer.archived}
							active={effectiveSelectedTab === "comments"}
							onOpenCommentTab={openCommentTab}
						/>
					)}
				</TabsContent>

				{/*
				 * Focused scope tabs. The baseline is not an entry, so it has its
				 * own component; every other tab resolves the entry from the
				 * detail metadata and shows a close action if it has vanished.
				 */}
				{scopeTabs.map((tab) => {
					const key = scopeTabKey(tab.id);

					if (tab.id === BASELINE_SCOPE_TAB_ID) {
						return (
							<TabsContent
								key={key}
								id={key}
								shouldForceMount
								className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
							>
								<BaselineScopeTab
									milestone={milestone}
									orgSlug={orgSlug}
									organizationId={organizationId}
									projectId={projectId}
									canEdit={canEditFields}
									locked={locked}
									canTickChecklist={viewer.canTickChecklist}
									scopeDraftRef={scopeDraftRef}
									onScopeChange={changeScope}
									saveState={saveState}
									saveError={saveError}
									toggleChecklist={toggleScopeChecklistItem}
									togglePending={toggleChecklist.isPending}
								/>
							</TabsContent>
						);
					}

					const entry = scopeEntries.find((item) => item.id === tab.id);

					if (!entry) {
						return (
							<TabsContent
								key={key}
								id={key}
								shouldForceMount
								className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
							>
								<div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
									<p className="text-sm text-app-text-muted">
										This section no longer exists.
									</p>
									<Button
										size="sm"
										variant="outline"
										onPress={() => closeScopeTab(tab.id)}
									>
										Close tab
									</Button>
								</div>
							</TabsContent>
						);
					}

					const current = isCurrentScopeEntry(
						entry,
						milestone.phase?.currentPeriodId ?? null,
					);

					return (
						<TabsContent
							key={key}
							id={key}
							shouldForceMount
							className="flex min-h-0 flex-1 flex-col data-[inert]:hidden"
						>
							<ScopeEntryTab
								orgSlug={orgSlug}
								organizationId={organizationId}
								projectId={projectId}
								milestoneId={milestone.id}
								entry={entry}
								active={effectiveSelectedTab === key}
								current={current}
								canWrite={canWriteScopeEntry(entry, viewer, {
									locked,
									current,
								})}
								onClose={() => closeScopeTab(tab.id)}
							/>
						</TabsContent>
					);
				})}

				{openCommentTabs.map((tab) => (
					<TabsContent
						key={tab.id}
						id={commentTabKey(tab.id)}
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
							archived={viewer.archived}
							active={effectiveSelectedTab === commentTabKey(tab.id)}
							onClose={() => closeCommentTab(tab.id)}
						/>
					</TabsContent>
				))}
			</Tabs>

			{canEditFields && (
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

			<MilestoneStatusReasonDialog
				isOpen={reasonStatus !== null}
				status={reasonStatus ?? "blocked"}
				onOpenChange={(open) => {
					if (!open) setReasonStatus(null);
				}}
				title={milestone.title}
				onConfirm={(reason) => {
					if (!reasonStatus) return;

					persistStatus(reasonStatus, reason);
					setReasonStatus(null);
				}}
			/>
		</section>
	);
}
