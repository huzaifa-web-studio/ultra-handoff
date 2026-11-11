/**
 * Checklist helpers for rich text bodies.
 *
 * Why a shared module: a checklist item can live inside a comment or inside a
 * milestone description, and both surfaces need to find one by id without
 * walking the whole document in their own way. The editor stores the state as
 * `checked` on the list item itself and the sanitizer guarantees every item has
 * a stable `id`, so a targeted toggle never has to rewrite the text.
 *
 * Used by: src/services/comment.service.ts and src/services/milestone.service.ts.
 */

/** One checklist item inside a sanitized body. */
export type ChecklistItem = Record<string, unknown> & {
	id: string;
	checked: boolean;
};

/**
 * Find a checklist item by id, walking nested lists.
 *
 * Returns null when no item carries the id, which the caller turns into a 404.
 * The walk is depth first because a nested checklist is still part of the same
 * document and its items are just as real.
 */
export function findChecklistItem(
	nodes: unknown[],
	itemId: string,
): ChecklistItem | null {
	for (const node of nodes) {
		if (!node || typeof node !== "object") continue;

		const record = node as Record<string, unknown>;

		if (record.id === itemId && typeof record.checked === "boolean") {
			return record as ChecklistItem;
		}

		if (Array.isArray(record.children)) {
			const found = findChecklistItem(record.children, itemId);

			if (found) return found;
		}
	}

	return null;
}
