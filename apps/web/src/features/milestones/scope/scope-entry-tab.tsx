"use client";

/**
 * One focused scope section tab.
 *
 * Why a tab instead of an expandable card: a milestone can accumulate many
 * accepted changes, test rounds and review rounds. Expanding them in place
 * means scrolling past every document to reach the next one. A focused tab
 * gives the section the full pane, and the reader moves between sections the
 * same way they move between focused discussions.
 *
 * The body is fetched by id only after the tab is first shown, so opening
 * several tabs costs nothing until each one is visited. A section this viewer
 * may write opens straight into the editor, because the document autosaves as
 * you type. A section that is frozen, locked or owned by somebody else renders
 * the read-only view instead.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { Button } from "@org/ui/components/button";
import { ScrollArea } from "@org/ui/components/scroll-area";
import { RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	MilestoneEditor,
	MilestoneEditorStatic,
} from "#/components/rich-text/milestone-editor";
import { useDebouncedCallback } from "#/hooks/use-debounced-callback";
import { formatDate } from "#/lib/date";
import type { MilestoneScopeEntrySummary } from "../api";
import { useMilestoneScopeEntry, useUpdateMilestoneScopeEntry } from "../hooks";
import { ScopeKindChip } from "./scope-kind-chip";
import {
	ScopeSaveIndicator,
	type ScopeSaveState,
} from "./scope-save-indicator";

/** The sentence shown for an empty section, by kind. */
const EMPTY_TEXT: Record<MilestoneScopeEntrySummary["kind"], string> = {
	change: "The accepted scope was empty.",
	test: "No findings recorded for this round.",
	review: "No review notes yet.",
};

/** The accessible name of the editor, by kind. */
const EDITOR_LABEL: Record<MilestoneScopeEntrySummary["kind"], string> = {
	change: "accepted scope",
	test: "test findings",
	review: "review notes",
};

export function ScopeEntryTab({
	orgSlug,
	organizationId,
	projectId,
	milestoneId,
	entry,
	active,
	current,
	canWrite,
	onClose,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestoneId: string;
	entry: MilestoneScopeEntrySummary;
	/** True while this tab is the selected one. */
	active: boolean;
	/** True when this section belongs to the currently open phase period. */
	current: boolean;
	/** True when this viewer may write this section right now. */
	canWrite: boolean;
	onClose: () => void;
}) {
	// The tab is force mounted, but the query and the editor should only start
	// after the reader has actually visited this tab once.
	const [hasBeenActive, setHasBeenActive] = useState(active);

	useEffect(() => {
		if (active) setHasBeenActive(true);
	}, [active]);

	const bodyQuery = useMilestoneScopeEntry(
		orgSlug,
		projectId,
		milestoneId,
		entry.id,
		{ enabled: hasBeenActive },
	);
	const update = useUpdateMilestoneScopeEntry(orgSlug, projectId);

	const [saveState, setSaveState] = useState<ScopeSaveState>("idle");
	const [saveError, setSaveError] = useState<string | null>(null);

	// The hook flushes a pending save on unmount, so closing the tab or leaving
	// the milestone never drops the last keystrokes.
	const saveBody = useDebouncedCallback((value: unknown[]) => {
		setSaveState("saving");
		setSaveError(null);

		update.mutate(
			{
				milestoneId,
				entryId: entry.id,
				patch: { body: value },
			},
			{
				onSuccess: () => setSaveState("saved"),
				onError: (error) => {
					setSaveState("error");
					setSaveError(
						error instanceof Error
							? error.message
							: "Could not save the scope section.",
					);
				},
			},
		);
	}, 800);

	const body = bodyQuery.data?.body ?? [];
	const kindLabel = EDITOR_LABEL[entry.kind];

	if (!hasBeenActive) return null;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="flex flex-wrap items-start justify-between gap-2 border-b border-app-border px-4 py-3">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<ScopeKindChip kind={entry.kind} />
						<h3 className="min-w-0 truncate font-display text-sm font-bold text-app-text">
							{entry.title}
						</h3>
						{current && (
							<span className="bg-app-selected px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest text-app-text uppercase">
								Current
							</span>
						)}
					</div>

					<span className="text-xs text-app-text-muted">
						{entry.createdByName ?? "Former member"} ·{" "}
						{formatDate(entry.createdAt)}
						{entry.updatedAt !== entry.createdAt && (
							<> · edited {formatDate(entry.updatedAt)}</>
						)}
					</span>
				</div>

				<div className="flex shrink-0 items-center gap-1">
					<ScopeSaveIndicator state={saveState} error={saveError} />
				</div>
			</header>

			<ScrollArea className="min-h-0 flex-1">
				{bodyQuery.isPending ? (
					<div className="flex flex-col gap-2 p-4" aria-hidden>
						<div className="h-4 w-2/3 animate-pulse bg-app-panel-subtle" />
						<div className="h-4 w-full animate-pulse bg-app-panel-subtle" />
						<div className="h-4 w-1/2 animate-pulse bg-app-panel-subtle" />
					</div>
				) : bodyQuery.isError ? (
					<div className="flex flex-wrap items-center gap-2 p-4 text-xs text-danger">
						<span className="flex-1">
							{bodyQuery.error instanceof Error
								? bodyQuery.error.message
								: "Could not load the scope section."}
						</span>
						<Button
							size="xs"
							variant="outline"
							onPress={() => void bodyQuery.refetch()}
						>
							<RefreshCwIcon aria-hidden />
							Try again
						</Button>
						<Button size="xs" variant="ghost" onPress={onClose}>
							<XIcon aria-hidden />
							Close tab
						</Button>
					</div>
				) : canWrite ? (
					<MilestoneEditor
						key={`scope-entry-${entry.id}`}
						initialValue={body}
						onChange={(value) => saveBody.schedule(value)}
						ariaLabel={`${entry.title} ${kindLabel}`}
						organizationId={organizationId}
						organizationSlug={orgSlug}
						projectId={projectId}
						contentClassName="min-h-[50svh]"
					/>
				) : body.length > 0 ? (
					<MilestoneEditorStatic
						// Remount when the stored body changes, so a save made in
						// another tab lands instead of showing the old text.
						key={`${entry.id}-${entry.updatedAt}`}
						value={body}
						ariaLabel={`${entry.title} ${kindLabel}`}
						organizationSlug={orgSlug}
					/>
				) : (
					<p className="p-4 text-sm text-app-text-muted">
						{EMPTY_TEXT[entry.kind]}
					</p>
				)}
			</ScrollArea>
		</div>
	);
}
