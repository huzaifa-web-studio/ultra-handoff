"use client";

/**
 * The focused tab for the initial scope.
 *
 * Why the baseline gets a tab of its own: it is the document the lock protects
 * and the document every addition is measured against, so it deserves the full
 * pane instead of being the thing a reader scrolls past to reach the additions.
 *
 * The draft and the debounced save stay in the detail panel and are passed in,
 * so closing this tab never loses text that has not reached the server yet.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { ScrollArea } from "@org/ui/components/scroll-area";
import type * as React from "react";
import {
	MilestoneEditor,
	MilestoneEditorStatic,
} from "#/components/rich-text/milestone-editor";
import type { MilestoneDetail } from "../api";
import { ScopeKindChip } from "./scope-kind-chip";
import {
	ScopeSaveIndicator,
	type ScopeSaveState,
} from "./scope-save-indicator";

export function BaselineScopeTab({
	milestone,
	orgSlug,
	organizationId,
	projectId,
	canEdit,
	locked,
	canTickChecklist,
	scopeDraftRef,
	onScopeChange,
	saveState,
	saveError,
	toggleChecklist,
	togglePending,
}: {
	milestone: MilestoneDetail;
	orgSlug: string;
	organizationId: string;
	projectId: string;
	/** True when the viewer may rewrite the initial scope right now. */
	canEdit: boolean;
	locked: boolean;
	canTickChecklist: boolean;
	scopeDraftRef: React.RefObject<unknown[]>;
	onScopeChange: (value: unknown[]) => void;
	saveState: ScopeSaveState;
	saveError: string | null;
	toggleChecklist: (itemId: string, checked: boolean) => Promise<void>;
	togglePending: boolean;
}) {
	const empty = milestone.description.length === 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="flex flex-wrap items-start justify-between gap-2 border-b border-app-border px-4 py-3">
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<ScopeKindChip kind="baseline" />
						<h3 className="min-w-0 truncate font-display text-sm font-bold text-app-text">
							Initial scope
						</h3>
					</div>

					<span className="text-xs text-app-text-muted">
						{locked
							? "Frozen while the milestone is locked. Staff can still tick checklist items."
							: "The agreed baseline. Every accepted change and phase round opens as its own tab."}
					</span>
				</div>

				<ScopeSaveIndicator state={saveState} error={saveError} />
			</header>

			<ScrollArea className="min-h-0 flex-1">
				{canEdit ? (
					<MilestoneEditor
						key={`baseline-${milestone.id}`}
						initialValue={scopeDraftRef.current}
						onChange={onScopeChange}
						ariaLabel="Milestone scope"
						organizationId={organizationId}
						organizationSlug={orgSlug}
						projectId={projectId}
						contentClassName="min-h-[60svh]"
					/>
				) : empty ? (
					<p className="p-4 text-sm text-app-text-muted">
						No scope written yet.
					</p>
				) : (
					<MilestoneEditorStatic
						// Remount when the stored body changes, so a tick lands instead
						// of leaving a checkbox that disagrees with the server.
						key={`baseline-${milestone.id}-${milestone.updatedAt}`}
						value={milestone.description}
						ariaLabel="Milestone scope"
						organizationSlug={orgSlug}
						checklist={
							locked && canTickChecklist
								? {
										disabled: togglePending,
										onToggle: toggleChecklist,
									}
								: undefined
						}
					/>
				)}
			</ScrollArea>
		</div>
	);
}
