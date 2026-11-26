/**
 * Persistence for open thread tabs.
 *
 * Why local storage: the reader explicitly opened these threads, and they
 * should still be there after a reload or a trip to another conversation. The
 * key is per conversation, so a different chat starts with no thread tabs.
 *
 * The stored shape is deliberately small: the root id plus the label the tab
 * bar renders. The thread is fetched by id, so a stale label can never hide a
 * fresh thread.
 *
 * Used by: conversation-view.tsx and thread-view.tsx.
 */

import type { ConversationMessage } from "./api";

/** One open thread tab, as the tab bar renders it. */
export type OpenThreadTab = {
	rootId: string;
	label: string;
	title: string;
};

/** Storage key for one conversation's open thread tabs. */
export function threadTabsStorageKey(
	orgSlug: string,
	conversationId: string,
): string {
	return `handoff:dm-threads:${orgSlug}:${conversationId}`;
}

/** Build the tab entry for a root message. */
export function toOpenThreadTab(
	root: Pick<ConversationMessage, "id" | "author" | "body">,
): OpenThreadTab {
	const author = root.author?.name ?? "Former member";
	const text = commentText(root.body).replace(/\s+/g, " ").trim();

	if (text.length === 0) {
		return { rootId: root.id, label: author, title: author };
	}

	const short = text.length > 36 ? `${text.slice(0, 36)}...` : text;

	return {
		rootId: root.id,
		label: `${author}: ${short}`,
		title: `${author}: ${text}`,
	};
}

/** A placeholder tab used before the root has loaded. */
export function placeholderThreadTab(rootId: string): OpenThreadTab {
	return { rootId, label: "Thread", title: "" };
}

/** Walk an editor value and join its text leaves. */
function commentText(value: unknown[]): string {
	const parts: string[] = [];

	function walk(node: unknown): void {
		if (!node || typeof node !== "object") return;

		const record = node as Record<string, unknown>;

		if (typeof record.text === "string") {
			parts.push(record.text);
			return;
		}

		if (Array.isArray(record.children)) {
			for (const child of record.children) walk(child);
		}
	}

	for (const node of value) walk(node);

	return parts.join(" ");
}

/** True when a stored value looks like an open thread tab. */
function isOpenThreadTab(value: unknown): value is OpenThreadTab {
	if (!value || typeof value !== "object") return false;

	const record = value as Record<string, unknown>;

	return (
		typeof record.rootId === "string" &&
		record.rootId.length > 0 &&
		typeof record.label === "string" &&
		typeof record.title === "string"
	);
}

/** Read the open tabs, ignoring anything malformed. */
export function readThreadTabs(key: string): OpenThreadTab[] {
	if (typeof window === "undefined") return [];

	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return [];

		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];

		const seen = new Set<string>();
		const tabs: OpenThreadTab[] = [];

		for (const value of parsed) {
			if (!isOpenThreadTab(value) || seen.has(value.rootId)) continue;

			seen.add(value.rootId);
			tabs.push(value);
		}

		return tabs;
	} catch {
		return [];
	}
}

/** Persist the open tabs. A failure must never break the tab bar. */
export function writeThreadTabs(key: string, tabs: OpenThreadTab[]): void {
	if (typeof window === "undefined") return;

	try {
		window.localStorage.setItem(key, JSON.stringify(tabs));
	} catch {
		// A full or disabled store is not something to interrupt the reader for.
	}
}

/** Add one tab, keeping the existing order. */
export function addThreadTab(key: string, tab: OpenThreadTab): OpenThreadTab[] {
	const current = readThreadTabs(key);

	if (current.some((item) => item.rootId === tab.rootId)) return current;

	const next = [...current, tab];

	writeThreadTabs(key, next);

	return next;
}

/** Replace a tab's label without changing its position. */
export function updateThreadTab(
	key: string,
	tab: OpenThreadTab,
): OpenThreadTab[] {
	const current = readThreadTabs(key);
	const next = current.map((item) => (item.rootId === tab.rootId ? tab : item));

	writeThreadTabs(key, next);

	return next;
}

/** Remove one tab. */
export function removeThreadTab(key: string, rootId: string): OpenThreadTab[] {
	const next = readThreadTabs(key).filter((item) => item.rootId !== rootId);

	writeThreadTabs(key, next);

	return next;
}
