"use client";

/**
 * The milestone overview tab.
 *
 * Why this file: the overview is a self-contained read and form surface. Keeping
 * it out of the content component means the content component owns tab state and
 * drafts, and this file owns the metadata grid, the scope and change summaries,
 * the phase card and the save footer.
 *
 * Used by: `milestone-detail-panel.tsx`.
 */

import { Button } from "@org/ui/components/button";
import { ScrollArea } from "@org/ui/components/scroll-area";
import { AlertTriangleIcon } from "lucide-react";
import { UserAvatar } from "#/components/user-avatar";
import { formatDate } from "#/lib/date";
import type { MilestoneDetail, MilestoneScopeEntrySummary } from "../api";
import { OverviewChanges } from "../changes/overview-changes";
import type { AssignableMember } from "../milestone-assignee-field";
import { MilestoneAssigneeField } from "../milestone-assignee-field";
import { MilestoneDateRangeField } from "../milestone-date-range-field";
import { MilestoneEstimateField } from "../milestone-estimate-field";
import { MilestonePhaseCard } from "../milestone-phase-card";
import { MilestoneStatusSelect } from "../milestone-status-select";
import type { MilestoneStatus } from "../schema";
import { isCurrentScopeEntry } from "../scope/permissions";
import { ScopeIndexRow } from "../scope/scope-index-row";
import type { MilestoneTabKey } from "../tabs";
import { MetaField, type SaveState, SaveStatus } from "./atoms";

export function MilestoneOverviewTab({
	externalUpdate,
	onReload,
	status,
	canEditLifecycle,
	changeStatus,
	milestone,
	canEditFields,
	changeEstimate,
	dates,
	changeDates,
	members,
	assigneeIds,
	changeAssignees,
	scopeEntries,
	latestScopeEntries,
	locked,
	openBaselineScopeTab,
	openEntryScopeTab,
	onTabChange,
	orgSlug,
	projectId,
	effectiveSelectedTab,
	saveState,
	saveError,
	retryFailedSave,
}: {
	externalUpdate: boolean;
	onReload: () => void;
	status: MilestoneStatus;
	canEditLifecycle: boolean;
	changeStatus: (next: MilestoneStatus) => void;
	milestone: MilestoneDetail;
	canEditFields: boolean;
	changeEstimate: (minutes: number | null) => void;
	dates: { startDate: string | null; dueDate: string | null };
	changeDates: (next: {
		startDate: string | null;
		dueDate: string | null;
	}) => void;
	members: AssignableMember[];
	assigneeIds: string[];
	changeAssignees: (next: string[]) => void;
	scopeEntries: MilestoneScopeEntrySummary[];
	latestScopeEntries: MilestoneScopeEntrySummary[];
	locked: boolean;
	openBaselineScopeTab: () => void;
	openEntryScopeTab: (entry: MilestoneScopeEntrySummary) => void;
	onTabChange: (tab: MilestoneTabKey) => void;
	orgSlug: string;
	projectId: string;
	effectiveSelectedTab: MilestoneTabKey;
	saveState: SaveState;
	saveError: string | null;
	retryFailedSave: () => Promise<void>;
}) {
	return (
		<>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-6 p-4">
					{externalUpdate && (
						<div
							aria-live="polite"
							className="flex flex-wrap items-center gap-2 border border-warning bg-warning-bg p-3 text-xs text-warning"
						>
							<AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
							<span className="flex-1">
								Someone else edited the milestone details. Reload to see their
								changes.
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
					{milestone.phase && <MilestonePhaseCard phase={milestone.phase} />}

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
		</>
	);
}
