/**
 * Scope tab storage tests.
 *
 * Why these exist: a stored tab outlives the section it points at, so pruning
 * is the thing that stops a dead tab from opening an empty pane. The rules are
 * small but easy to get wrong, and a wrong prune silently loses a reader's tab.
 */

import { describe, expect, it } from "bun:test";

import type { MilestoneScopeEntrySummary } from "../api";
import { BASELINE_SCOPE_TAB_ID } from "../tabs";
import {
	baselineScopeTab,
	type OpenScopeTab,
	pruneScopeTabs,
	scopeTabsEqual,
	toOpenScopeTab,
} from "./tabs-storage";

/** One scope section with the fields a tab reads. */
function makeEntry(
	overrides: Partial<MilestoneScopeEntrySummary> &
		Pick<MilestoneScopeEntrySummary, "id" | "kind" | "title">,
): MilestoneScopeEntrySummary {
	return {
		round: null,
		hasBody: false,
		changeRequestId: null,
		statusPeriodId: null,
		createdBy: null,
		createdByName: null,
		updatedBy: null,
		updatedByName: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("toOpenScopeTab", () => {
	it("uses the section title as the label", () => {
		const tab = toOpenScopeTab(
			makeEntry({ id: "entry-1", kind: "test", title: "Test round 2" }),
		);

		expect(tab).toEqual({
			id: "entry-1",
			label: "Test round 2",
			kind: "test",
		});
	});
});

describe("pruneScopeTabs", () => {
	it("keeps the baseline and every section that still exists", () => {
		const entries = [
			makeEntry({ id: "entry-1", kind: "change", title: "Contact page" }),
			makeEntry({ id: "entry-2", kind: "review", title: "Review round 1" }),
		];
		const tabs: OpenScopeTab[] = [
			baselineScopeTab(),
			{ id: "entry-1", label: "Contact page", kind: "change" },
			{ id: "entry-2", label: "Review round 1", kind: "review" },
		];

		expect(pruneScopeTabs(tabs, entries)).toEqual(tabs);
	});

	it("drops a tab whose section is gone", () => {
		const tabs: OpenScopeTab[] = [
			baselineScopeTab(),
			{ id: "missing", label: "Gone", kind: "test" },
		];

		expect(pruneScopeTabs(tabs, [])).toEqual([baselineScopeTab()]);
	});

	it("refreshes the label and kind from the section", () => {
		const entries = [
			makeEntry({ id: "entry-1", kind: "change", title: "Renamed" }),
		];
		const tabs: OpenScopeTab[] = [
			{ id: "entry-1", label: "Old name", kind: "test" },
		];

		expect(pruneScopeTabs(tabs, entries)).toEqual([
			{ id: "entry-1", label: "Renamed", kind: "change" },
		]);
	});

	it("keeps the baseline even when it is not first", () => {
		const tabs: OpenScopeTab[] = [
			{ id: "entry-1", label: "Contact page", kind: "change" },
			{ id: BASELINE_SCOPE_TAB_ID, label: "Initial scope", kind: "baseline" },
		];

		expect(pruneScopeTabs(tabs, [])).toEqual([baselineScopeTab()]);
	});
});

describe("scopeTabsEqual", () => {
	it("compares order, id, label and kind", () => {
		const a: OpenScopeTab[] = [
			{ id: "one", label: "One", kind: "test" },
			{ id: "two", label: "Two", kind: "review" },
		];

		expect(scopeTabsEqual(a, [...a])).toBe(true);
		expect(scopeTabsEqual(a, [...a].reverse())).toBe(false);
		expect(scopeTabsEqual(a, [{ ...a[0], label: "Renamed" }, a[1]])).toBe(
			false,
		);
		expect(scopeTabsEqual(a, [a[0]])).toBe(false);
	});
});
