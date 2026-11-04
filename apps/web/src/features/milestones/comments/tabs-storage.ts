/**
 * Persistence for the focused comment tabs.
 *
 * Why local storage: the reader explicitly opened these discussions, and they
 * should still be there after a reload or a trip to another tab. The key is per
 * milestone, so a different milestone starts with no comment tabs open.
 *
 * The stored shape is deliberately small: the id plus the label the tab bar
 * renders. The thread itself is fetched by id, so a stale label can never hide a
 * fresh discussion.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import type { Comment } from "./api";
import { commentTabLabel } from "./comment-utils";

/** One focused comment tab, as the tab bar renders it. */
export type OpenCommentTab = {
	id: string;
	label: string;
	title: string;
};

/** Storage key for one milestone's open comment tabs. */
export function commentTabsStorageKey(
	orgSlug: string,
	milestoneId: string,
): string {
	return `handoff:comment-tabs:${orgSlug}:${milestoneId}`;
}

/** Build the tab entry for a root comment. */
export function toOpenCommentTab(comment: Comment): OpenCommentTab {
	const { label, title } = commentTabLabel(comment);

	return { id: comment.id, label, title };
}

/** True when a stored value looks like an open tab. */
function isOpenCommentTab(value: unknown): value is OpenCommentTab {
	if (!value || typeof value !== "object") return false;

	const record = value as Record<string, unknown>;

	return (
		typeof record.id === "string" &&
		record.id.length > 0 &&
		typeof record.label === "string" &&
		typeof record.title === "string"
	);
}

/** Read the open tabs, ignoring anything malformed. */
export function readCommentTabs(key: string): OpenCommentTab[] {
	if (typeof window === "undefined") return [];

	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return [];

		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];

		const seen = new Set<string>();
		const tabs: OpenCommentTab[] = [];

		for (const value of parsed) {
			if (!isOpenCommentTab(value) || seen.has(value.id)) continue;

			seen.add(value.id);
			tabs.push(value);
		}

		return tabs;
	} catch {
		return [];
	}
}

/** Persist the open tabs. A failure must never break the tab bar. */
export function writeCommentTabs(key: string, tabs: OpenCommentTab[]): void {
	if (typeof window === "undefined") return;

	try {
		window.localStorage.setItem(key, JSON.stringify(tabs));
	} catch {
		// A full or disabled store is not something to interrupt the reader for.
	}
}
