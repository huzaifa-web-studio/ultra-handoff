"use client";

/**
 * Draft persistence for a conversation.
 *
 * Why local storage: a half written message should survive a reload, a route
 * change or a workspace tab switch. The key is per conversation, so two chats
 * never share a draft. Storage is a convenience only; a disabled store falls
 * back to in-memory state for the mount.
 *
 * Used by: message-composer.tsx.
 */

/** Storage key for one conversation draft. */
export function draftStorageKey(
	orgSlug: string,
	conversationId: string,
): string {
	return `handoff:dm-draft:${orgSlug}:${conversationId}`;
}

/** Read a stored draft, ignoring anything malformed. */
export function readDraft(key: string): unknown[] {
	if (typeof window === "undefined") return [];

	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return [];

		const parsed: unknown = JSON.parse(raw);

		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Persist a draft. A failure must never interrupt typing. */
export function writeDraft(key: string, value: unknown[]): void {
	if (typeof window === "undefined") return;

	try {
		if (value.length === 0) {
			window.localStorage.removeItem(key);
			return;
		}

		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// A full or disabled store is not something to interrupt the writer for.
	}
}
