/**
 * Persistence for the focused scope tabs.
 *
 * Why local storage: the reader explicitly opened these sections, and they
 * should still be there after a reload or a trip to another milestone tab. The
 * key is per milestone, so a different milestone starts with no scope tabs
 * open.
 *
 * The stored shape is deliberately small: the id, the label the tab strip
 * renders and the kind that colours it. The body is fetched by id, and the
 * label and kind are refreshed from the milestone detail on every load, so a
 * stale record can never hide a fresh section.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import type { MilestoneScopeEntrySummary } from "../api";
import { BASELINE_SCOPE_TAB_ID } from "../tabs";
import { SCOPE_TAB_KINDS, type ScopeTabKind } from "./scope-kind";

/** One focused scope tab, as the tab bar renders it. */
export type OpenScopeTab = {
	id: string;
	label: string;
	kind: ScopeTabKind;
};

/** The label used for the initial scope tab. */
export const BASELINE_SCOPE_TAB_LABEL = "Initial scope";

/** Storage key for one milestone's open scope tabs. */
export function scopeTabsStorageKey(
	orgSlug: string,
	milestoneId: string,
): string {
	return `handoff:scope-tabs:${orgSlug}:${milestoneId}`;
}

/** The tab entry for the initial scope. */
export function baselineScopeTab(): OpenScopeTab {
	return {
		id: BASELINE_SCOPE_TAB_ID,
		label: BASELINE_SCOPE_TAB_LABEL,
		kind: "baseline",
	};
}

/** Build the tab entry for one scope section. */
export function toOpenScopeTab(
	entry: MilestoneScopeEntrySummary,
): OpenScopeTab {
	return { id: entry.id, label: entry.title, kind: entry.kind };
}

/** True when a stored value looks like an open scope tab. */
function isOpenScopeTab(value: unknown): value is OpenScopeTab {
	if (!value || typeof value !== "object") return false;

	const record = value as Record<string, unknown>;

	return (
		typeof record.id === "string" &&
		record.id.length > 0 &&
		typeof record.label === "string" &&
		typeof record.kind === "string" &&
		SCOPE_TAB_KINDS.includes(record.kind as ScopeTabKind)
	);
}

/** Read the open tabs, ignoring anything malformed. */
export function readScopeTabs(key: string): OpenScopeTab[] {
	if (typeof window === "undefined") return [];

	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return [];

		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];

		const seen = new Set<string>();
		const tabs: OpenScopeTab[] = [];

		for (const value of parsed) {
			if (!isOpenScopeTab(value) || seen.has(value.id)) continue;

			seen.add(value.id);
			tabs.push(value);
		}

		return tabs;
	} catch {
		return [];
	}
}

/** Persist the open tabs. A failure must never break the tab bar. */
export function writeScopeTabs(key: string, tabs: OpenScopeTab[]): void {
	if (typeof window === "undefined") return;

	try {
		window.localStorage.setItem(key, JSON.stringify(tabs));
	} catch {
		// A full or disabled store is not something to interrupt the reader for.
	}
}

/**
 * Drop tabs whose section no longer exists and refresh the rest.
 *
 * Why prune instead of trusting local storage: a section can vanish when the
 * milestone is edited elsewhere, and a tab that points at nothing would open an
 * empty pane. The baseline always survives because it is not an entry.
 */
export function pruneScopeTabs(
	tabs: OpenScopeTab[],
	entries: MilestoneScopeEntrySummary[],
): OpenScopeTab[] {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const next: OpenScopeTab[] = [];

	for (const tab of tabs) {
		if (tab.id === BASELINE_SCOPE_TAB_ID) {
			next.push(baselineScopeTab());
			continue;
		}

		const entry = byId.get(tab.id);
		if (!entry) continue;

		next.push(toOpenScopeTab(entry));
	}

	return next;
}

/** True when two tab lists render the same thing. */
export function scopeTabsEqual(
	left: OpenScopeTab[],
	right: OpenScopeTab[],
): boolean {
	if (left.length !== right.length) return false;

	return left.every(
		(tab, index) =>
			tab.id === right[index]?.id &&
			tab.label === right[index]?.label &&
			tab.kind === right[index]?.kind,
	);
}
