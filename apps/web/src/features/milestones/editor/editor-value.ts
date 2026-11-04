/**
 * Editor value helpers shared by every Plate surface.
 *
 * Why extracted: the milestone editor and the comment editor both need "turn a
 * stored empty array into something Slate can mount" and both must clone the
 * value before handing it over. Two copies would eventually disagree on the
 * clone, and a missing clone edits the React Query cache in place.
 *
 * Used by: editor/milestone-editor.tsx and comments/editor/comment-editor.tsx.
 */

import type { Value } from "platejs";

/**
 * The empty document.
 *
 * Slate requires at least one text node, so "nothing written yet" still has a
 * real paragraph to focus. The API stores an empty array for an empty body, and
 * this is the only place that turns it back into something editable.
 */
export const EMPTY_EDITOR_VALUE = [{ type: "p", children: [{ text: "" }] }];

/**
 * Normalise a stored value into something Slate can mount.
 *
 * The clone is not optional: Slate mutates its `children` array while typing,
 * and the stored value lives in the React Query cache. Handing that array over
 * directly would edit the cache in place and make a discarded draft look saved.
 */
export function toEditorValue(value: unknown[]): Value {
	if (value.length === 0) return structuredClone(EMPTY_EDITOR_VALUE) as Value;

	return structuredClone(value) as Value;
}
