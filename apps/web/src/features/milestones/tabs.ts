/**
 * The milestone detail tab vocabulary.
 *
 * Why a module of its own: the tab key is part of three contracts at once. The
 * tab strip renders it, local storage persists it, and the URL carries it. A
 * prefix or pattern that drifts between those three turns a deep link into a
 * silent redirect, so the allowlist lives here and every surface imports it.
 *
 * Two kinds of reader tab exist:
 *   - `scope:<id>` focuses one scope section, where `<id>` is a scope entry id
 *     or `baseline` for the initial scope
 *   - `comment:<id>` focuses one discussion thread
 *
 * Used by: milestone-detail-panel.tsx, scope/tabs-storage.ts and the
 * milestones route.
 */

/** The tab id that selects the initial scope document. */
export const BASELINE_SCOPE_TAB_ID = "baseline";

/** Prefix for a focused scope tab. */
export const SCOPE_TAB_PREFIX = "scope:";

/** Prefix for a focused comment tab. */
export const COMMENT_TAB_PREFIX = "comment:";

/**
 * Characters a focused tab id may contain.
 *
 * A scope entry id is a UUID and `baseline` is a word, so this covers both and
 * still rejects anything a hand edited URL could try to smuggle in.
 */
const TAB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The sections of the milestone detail pane. */
export type MilestoneTabKey =
	| "overview"
	| "scope"
	| "changes"
	| "comments"
	| `scope:${string}`
	| `comment:${string}`;

/**
 * The tab values the URL contract accepts.
 *
 * `overview` is the default, so it is never written to the URL.
 */
export type MilestoneTabSearch = Exclude<MilestoneTabKey, "overview">;

/** Build the tab key for one scope section. */
export function scopeTabKey(id: string): `scope:${string}` {
	return `${SCOPE_TAB_PREFIX}${id}`;
}

/**
 * Read the section id out of a scope tab key, or null.
 *
 * This validates the id as it goes, so a malformed key never reaches a query.
 */
export function scopeTabId(key: string): string | null {
	if (!key.startsWith(SCOPE_TAB_PREFIX)) return null;

	const id = key.slice(SCOPE_TAB_PREFIX.length);

	return TAB_ID_PATTERN.test(id) ? id : null;
}

/** True when the key selects one scope section. */
export function isScopeTabKey(key: string): key is `scope:${string}` {
	return scopeTabId(key) !== null;
}

/** Build the tab key for one discussion thread. */
export function commentTabKey(id: string): `comment:${string}` {
	return `${COMMENT_TAB_PREFIX}${id}`;
}

/**
 * Read the thread id out of a comment tab key, or null.
 *
 * The id is validated as it is read, so a deep link can never put an arbitrary
 * string into a thread query.
 */
export function commentTabId(key: string): string | null {
	if (!key.startsWith(COMMENT_TAB_PREFIX)) return null;

	const id = key.slice(COMMENT_TAB_PREFIX.length);

	return TAB_ID_PATTERN.test(id) ? id : null;
}

/** True when the key selects one discussion thread. */
export function isCommentTabKey(key: string): key is `comment:${string}` {
	return commentTabId(key) !== null;
}

/** True when a value is a tab key this product understands. */
export function isMilestoneTabKey(value: unknown): value is MilestoneTabKey {
	if (typeof value !== "string") return false;

	return (
		value === "overview" ||
		value === "scope" ||
		value === "changes" ||
		value === "comments" ||
		isScopeTabKey(value) ||
		isCommentTabKey(value)
	);
}

/**
 * Resolve a selected tab against the reader's open tabs.
 *
 * A stored tab can disappear when local storage is cleared, and a URL can carry
 * a tab that was never opened on this device. Both must land somewhere real
 * instead of an empty pane, and each prefix has an obvious parent tab.
 */
export function resolveMilestoneTab(
	tab: MilestoneTabKey,
	openTabKeys: ReadonlySet<MilestoneTabKey>,
): MilestoneTabKey {
	if (
		tab === "overview" ||
		tab === "scope" ||
		tab === "changes" ||
		tab === "comments"
	) {
		return tab;
	}

	if (isScopeTabKey(tab)) {
		return openTabKeys.has(tab) ? tab : "scope";
	}

	return openTabKeys.has(tab) ? tab : "comments";
}

/**
 * Read the `milestoneTab` search value.
 *
 * A hand edited or stale link can carry anything, so an unknown value is
 * dropped rather than passed to the detail pane.
 */
export function parseMilestoneTabSearch(
	value: unknown,
): MilestoneTabSearch | null {
	if (!isMilestoneTabKey(value)) return null;
	if (value === "overview") return null;

	return value;
}

/** Map a tab key to the value stored in the URL. */
export function toMilestoneTabSearchValue(
	tab: MilestoneTabKey,
): MilestoneTabSearch | null {
	if (tab === "overview") return null;
	if (!isMilestoneTabKey(tab)) return null;

	return tab;
}
