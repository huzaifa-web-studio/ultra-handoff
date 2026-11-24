"use client";

/**
 * The reader opened tabs for a milestone.
 *
 * Why this file: the scope section tabs and the focused discussion tabs are both
 * driven by the reader's tab list, not by the fixed sections. Keeping them in
 * one place means the close, missing section and active states stay consistent.
 *
 * Used by: `milestone-detail-panel.tsx`.
 */

import { Button } from "@org/ui/components/button";
import { TabsContent } from "@org/ui/components/tabs";
import type {
	MilestoneDetail,
	MilestoneScopeEntrySummary,
	MilestoneViewer,
} from "../api";
import type { Comment } from "../comments/api";
import { CommentThreadTab } from "../comments/comment-thread-tab";
import type { OpenCommentTab } from "../comments/tabs-storage";
import { BaselineScopeTab } from "../scope/baseline-scope-tab";
import { canWriteScopeEntry, isCurrentScopeEntry } from "../scope/permissions";
import { ScopeEntryTab } from "../scope/scope-entry-tab";
import type { OpenScopeTab } from "../scope/tabs-storage";
import {
	BASELINE_SCOPE_TAB_ID,
	commentTabKey,
	type MilestoneTabKey,
	scopeTabKey,
} from "../tabs";
import type { SaveState } from "./atoms";

/** A mutable ref, kept structural so the component does not import React types. */
type Mutable<T> = { current: T };

export function MilestoneReaderTabs({
	orgSlug,
	organizationId,
	projectId,
	milestone,
	viewer,
	locked,
	canEditFields,
	scopeTabs,
	commentTabs,
	scopeEntries,
	effectiveSelectedTab,
	scopeDraftRef,
	changeScope,
	saveState,
	saveError,
	toggleScopeChecklistItem,
	togglePending,
	closeScopeTab,
	closeCommentTab,
	handleCommentLoaded,
}: {
	orgSlug: string;
	organizationId: string;
	projectId: string;
	milestone: MilestoneDetail;
	viewer: MilestoneViewer;
	locked: boolean;
	canEditFields: boolean;
	scopeTabs: OpenScopeTab[];
	commentTabs: OpenCommentTab[];
	scopeEntries: MilestoneScopeEntrySummary[];
	effectiveSelectedTab: MilestoneTabKey;
	scopeDraftRef: Mutable<unknown[]>;
	changeScope: (value: unknown[]) => void;
	saveState: SaveState;
	saveError: string | null;
	toggleScopeChecklistItem: (itemId: string, checked: boolean) => Promise<void>;
	togglePending: boolean;
	closeScopeTab: (id: string) => void;
	closeCommentTab: (id: string) => void;
	handleCommentLoaded: (comment: Comment) => void;
}) {
	return (
		<>
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
								togglePending={togglePending}
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

			{commentTabs.map((tab) => (
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
						onLoaded={handleCommentLoaded}
					/>
				</TabsContent>
			))}
		</>
	);
}
