/**
 * Scope section write rules on the client.
 *
 * Why one module: the Scope index row and the focused section tab both need to
 * know whether to offer an editor, and two copies of this rule is how a row
 * offers an Edit that the server then rejects. The server remains the
 * authority; this only decides what the reader is shown.
 *
 * Used by: scope/scope-tab.tsx, scope/scope-entry-tab.tsx and
 * milestone-detail-panel.tsx.
 */

import type { MilestoneScopeEntrySummary, MilestoneViewer } from "../api";

/** The slice of the section this rule reads. */
type ScopeKindSource = Pick<MilestoneScopeEntrySummary, "kind">;

/** The slice of the viewer this rule reads. */
type ScopeViewer = Pick<
	MilestoneViewer,
	"canWrite" | "canWriteTestScope" | "canWriteReviewScope"
>;

/**
 * True when the section belongs to the currently open status period.
 *
 * A phase round is identified by its period, not by its status name, so a round
 * from an earlier visit is never treated as current.
 */
export function isCurrentScopeEntry(
	entry: Pick<MilestoneScopeEntrySummary, "statusPeriodId">,
	currentPeriodId: string | null,
): boolean {
	return (
		entry.statusPeriodId !== null && entry.statusPeriodId === currentPeriodId
	);
}

/**
 * True when this viewer may write one section right now.
 *
 * A test round is staff only and only during its visit. A review round is open
 * to every project member and only during its visit. An accepted change follows
 * the normal milestone write rule and stops while the milestone is locked.
 */
export function canWriteScopeEntry(
	entry: ScopeKindSource,
	viewer: ScopeViewer,
	options: { locked: boolean; current: boolean },
): boolean {
	if (entry.kind === "test") {
		return options.current && viewer.canWriteTestScope;
	}

	if (entry.kind === "review") {
		return options.current && viewer.canWriteReviewScope;
	}

	return viewer.canWrite && !options.locked;
}
