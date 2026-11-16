/**
 * The kinds of section a scope tab can show.
 *
 * Why separate from the API type: the initial scope is not a section row, so
 * the tab vocabulary needs one extra kind that the server never returns. A
 * shared union keeps the chip, the stored tab and the tab strip from drifting.
 *
 * Used by: scope-kind-chip.tsx, tabs-storage.ts and scope-index-row.tsx.
 */

import type { MilestoneScopeEntrySummary } from "../api";

/** Every kind a focusable scope tab can show. */
export type ScopeTabKind = "baseline" | MilestoneScopeEntrySummary["kind"];

/** Every kind a stored tab may carry, for runtime validation. */
export const SCOPE_TAB_KINDS: readonly ScopeTabKind[] = [
	"baseline",
	"change",
	"test",
	"review",
];
