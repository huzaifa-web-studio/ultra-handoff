"use client";

/**
 * The kind badge for one scope section.
 *
 * Text plus colour, never colour alone, so a reader who cannot distinguish the
 * tints still knows whether a section came from a change request, a test round
 * or a review round. The baseline gets its own neutral tint because it is the
 * agreed document rather than an addition.
 *
 * Used by: scope-index-row.tsx, scope-entry-tab.tsx and baseline-scope-tab.tsx.
 */

import type { ScopeTabKind } from "./scope-kind";

/** Label and token classes for each kind. */
const STYLES: Record<ScopeTabKind, { label: string; className: string }> = {
	baseline: {
		label: "Baseline",
		className: "bg-app-selected text-app-text",
	},
	change: {
		label: "Change",
		className: "bg-info-bg text-info",
	},
	test: {
		label: "Test",
		className: "bg-milestone-in-testing-bg text-milestone-in-testing",
	},
	review: {
		label: "Review",
		className: "bg-milestone-in-review-bg text-milestone-in-review",
	},
};

export function ScopeKindChip({ kind }: { kind: ScopeTabKind }) {
	const style = STYLES[kind];

	return (
		<span
			className={`inline-flex shrink-0 items-center px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-widest uppercase ${style.className}`}
		>
			{style.label}
		</span>
	);
}
