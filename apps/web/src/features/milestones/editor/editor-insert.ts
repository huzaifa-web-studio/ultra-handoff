"use client";

/**
 * Shared block insertion for the rich text editors.
 *
 * Why this module: the milestone gutter, the comment toolbar and the file drop
 * handler all insert a block at a known place and all need the same three
 * rules. Repeating them per surface is how they drift apart.
 *
 * The rules:
 *   - an empty top level paragraph is replaced, so a tool never leaves a blank
 *     line above the block it just added
 *   - anything else inserts after its top level block, so a table never lands
 *     inside a list item or another table
 *   - a paragraph is added below the new void block when it ends the document,
 *     so the caret always has somewhere to go
 *
 * Used by: editor-file-drop.tsx and comments/editor/comment-insert.ts.
 */

import {
	ElementApi,
	KEYS,
	type Path,
	PathApi,
	type TElement,
	type TRange,
} from "platejs";
import type { PlateEditor } from "platejs/react";

/** Where an insert should happen, captured before an async action starts. */
export type EditorInsertPoint = {
	at: Path;
	/** True when `at` points at the empty paragraph that should be replaced. */
	replaceEmpty: boolean;
};

/** True when the path is an empty top level paragraph. */
export function isEmptyRootParagraph(editor: PlateEditor, path: Path): boolean {
	if (path.length !== 1) return false;

	const node = editor.api.node(path)?.[0];

	return (
		ElementApi.isElement(node) &&
		node.type === editor.getType(KEYS.p) &&
		editor.api.string(path).trim().length === 0
	);
}

/**
 * Resolve the top level block an insert should use.
 *
 * A range is the normal input for a pointer action such as a drop, because the
 * caret can be somewhere else entirely. With no range the current selection is
 * used, and with no selection at all the block is appended at the end.
 */
export function resolveInsertPoint(
	editor: PlateEditor,
	range: TRange | null | undefined = editor.selection,
): EditorInsertPoint {
	const block = range
		? editor.api.above({
				at: range,
				match: (node) => editor.api.isBlock(node),
			})
		: undefined;

	const blockPath = block?.[1];

	if (!blockPath) {
		// No block means append at the end. The path may be one past the last
		// child, which `insertNodes` accepts as an append.
		return { at: [editor.children.length], replaceEmpty: false };
	}

	const rootPath: Path = [blockPath[0] ?? 0];

	if (isEmptyRootParagraph(editor, rootPath)) {
		return { at: rootPath, replaceEmpty: true };
	}

	return { at: PathApi.next(rootPath), replaceEmpty: false };
}

/**
 * Re-check a captured point after an async action.
 *
 * The document can change while an upload or a picker is open. Re-reading
 * emptiness is what stops the tool from deleting a paragraph the writer has
 * since filled in.
 */
export function refreshInsertPoint(
	editor: PlateEditor,
	point: EditorInsertPoint,
): EditorInsertPoint {
	if (!editor.api.node(point.at)) {
		return resolveInsertPoint(editor);
	}

	return {
		at: point.at,
		replaceEmpty: isEmptyRootParagraph(editor, point.at),
	};
}

/** Insert a paragraph below a new void block when there is nothing after it. */
export function ensureParagraphAfter(editor: PlateEditor, at: Path): void {
	const after = PathApi.next(at);

	if (!editor.api.node(after)) {
		editor.tf.insertNodes(
			{ type: "p", children: [{ text: "" }] },
			{ at: after },
		);
	}
}

/**
 * Insert one void block and leave the caret on the line below it.
 *
 * Returns the path the block ended up at, which is what a caller inserting
 * several blocks in a row needs to place the next one after it.
 */
export function insertVoidBlock(
	editor: PlateEditor,
	point: EditorInsertPoint,
	node: TElement,
): Path {
	const target = refreshInsertPoint(editor, point);

	editor.tf.withoutNormalizing(() => {
		if (target.replaceEmpty) editor.tf.removeNodes({ at: target.at });

		editor.tf.insertNodes(node, { at: target.at });
		ensureParagraphAfter(editor, target.at);
	});

	const below = editor.api.start(PathApi.next(target.at));
	if (below) editor.tf.select(below);

	editor.tf.focus();

	return target.at;
}
