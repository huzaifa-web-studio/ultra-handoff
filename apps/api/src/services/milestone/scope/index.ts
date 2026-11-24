/**
 * Public surface of the milestone scope module.
 *
 * Why: milestone and change request code should import one entry point instead
 * of reaching into individual files. Every name the old
 * `milestone/scope/` exported is re-exported here.
 *
 * Used by: `services/milestone/`, `services/change-request/`,
 * `routes/milestones.ts` and the integration suites.
 */

export { createChangeScopeEntry, createPhaseRoundEntry } from "./create";
export { getMilestoneScopeEntry, loadScopeEntries } from "./read";
export type {
	MilestoneScopeEntry,
	MilestoneScopeEntryRecord,
	MilestoneScopeEntrySummary,
	MilestoneScopeKind,
	MilestoneScopeUpdateResult,
	UpdateMilestoneScopeEntryInput,
} from "./types";
export { updateMilestoneScopeEntry } from "./update";
