"use client";

/**
 * The Scope tab.
 *
 * Why this is an index and not a document: a milestone accumulates one section
 * per accepted change and one per test or review round, and expanding each one
 * in place turns the tab into a long scroll where the newest section is the
 * hardest to reach. Here every section is a row, and the document itself opens
 * in its own focused tab.
 *
 * Order is deliberate: the initial scope first because it is the baseline, then
 * the round of the open phase because writing it is the action of that phase,
 * then every earlier addition.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import { ScrollArea } from "@org/ui/components/scroll-area";
import { formatDate } from "#/lib/date";
import type {
	MilestoneDetail,
	MilestonePhase,
	MilestoneScopeEntrySummary,
	MilestoneViewer,
} from "../api";
import { canWriteScopeEntry, isCurrentScopeEntry } from "./permissions";
import { ScopeIndexRow } from "./scope-index-row";

export function ScopeTab({
	milestone,
	phase,
	viewer,
	locked,
	canEditFields,
	onOpenBaseline,
	onOpenEntry,
}: {
	milestone: MilestoneDetail;
	phase: MilestonePhase | undefined;
	viewer: MilestoneViewer;
	locked: boolean;
	/** True when the viewer may write the initial scope right now. */
	canEditFields: boolean;
	onOpenBaseline: () => void;
	onOpenEntry: (entry: MilestoneScopeEntrySummary) => void;
}) {
	const entries = milestone.scopeEntries ?? [];
	const currentPeriodId = phase?.currentPeriodId ?? null;
	const currentEntry = entries.find((entry) =>
		isCurrentScopeEntry(entry, currentPeriodId),
	);
	const others = entries.filter((entry) => entry.id !== currentEntry?.id);
	const baselineExcerpt = milestone.excerpt;

	/** The action a row offers, which is writing only for the open phase. */
	function actionLabel(entry: MilestoneScopeEntrySummary): string {
		const writable = canWriteScopeEntry(entry, viewer, {
			locked,
			current: isCurrentScopeEntry(entry, currentPeriodId),
		});

		if (!writable) return "Open";
		if (entry.kind === "test") return "Write findings";
		if (entry.kind === "review") return "Write notes";

		// An accepted change is edited inside its tab, so the row only opens it.
		return "Open";
	}

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="flex flex-col gap-5 p-4">
				<p className="text-xs text-app-text-muted">
					{locked
						? "This milestone is locked. Open a section to read it. Staff can still tick checklist items in the initial scope, and the active phase still accepts notes."
						: canEditFields
							? "Open a section to read or edit it. The initial scope is the agreed baseline; every addition is a section of its own."
							: "Open a section to read it. The initial scope is the agreed baseline; every addition is a section of its own."}
				</p>

				<section className="flex flex-col gap-2">
					<h3 className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
						Initial scope
					</h3>

					<ScopeIndexRow
						kind="baseline"
						title="Initial scope"
						meta={
							locked
								? "Locked baseline"
								: canEditFields
									? "The agreed baseline, editable now"
									: "The agreed baseline"
						}
						excerpt={baselineExcerpt || "No scope written yet."}
						actionLabel={canEditFields ? "Write" : "Open"}
						onOpen={onOpenBaseline}
					/>
				</section>

				{currentEntry && (
					<section className="flex flex-col gap-2">
						<h3 className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							Current phase
						</h3>

						<ScopeIndexRow
							kind={currentEntry.kind}
							title={currentEntry.title}
							meta={`${currentEntry.createdByName ?? "Former member"} · ${formatDate(
								currentEntry.createdAt,
							)}`}
							excerpt={currentEntry.excerpt}
							badge="Current"
							highlight
							actionLabel={actionLabel(currentEntry)}
							onOpen={() => onOpenEntry(currentEntry)}
						/>
					</section>
				)}

				{others.length > 0 && (
					<section className="flex flex-col gap-2">
						<h3 className="text-[0.65rem] font-semibold tracking-widest text-app-text-muted uppercase">
							{currentEntry ? "Earlier additions" : "Scope additions"}
						</h3>

						<div className="flex flex-col gap-2">
							{others.map((entry) => (
								<ScopeIndexRow
									key={entry.id}
									kind={entry.kind}
									title={entry.title}
									meta={`${entry.createdByName ?? "Former member"} · ${formatDate(
										entry.createdAt,
									)}`}
									excerpt={entry.excerpt}
									actionLabel={actionLabel(entry)}
									onOpen={() => onOpenEntry(entry)}
								/>
							))}
						</div>
					</section>
				)}

				{entries.length === 0 && (
					<div className="flex flex-col gap-1 border border-dashed border-app-border p-3 text-sm text-app-text-muted">
						<span>No additions yet.</span>
						<span className="text-xs">
							Accepted change requests, test findings and review notes appear
							here as named sections.
						</span>
					</div>
				)}
			</div>
		</ScrollArea>
	);
}
