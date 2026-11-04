"use client";

/**
 * Block insertion helpers for the comment editor.
 *
 * Why this exists: the comment composer has no block gutter, so images, files
 * and tables are inserted from the bottom toolbar. A toolbar has a selection,
 * not a block, so the helpers turn the selection into the block path the
 * insertion should use and keep a paragraph below every void block.
 *
 * The rule matches the milestone gutter on purpose:
 *   - an empty paragraph is replaced, so the tool does not leave a blank line
 *     above the inserted block
 *   - anything else inserts after its top level block, so a table never lands
 *     inside a list item or another table
 *   - a paragraph is added below the new block when it ends the document, so
 *     the caret always has somewhere to go
 *
 * Used by: comments/editor/comment-toolbar.tsx.
 */

import { insertTable } from "@platejs/table";
import { ElementApi, KEYS, type Path, PathApi, type TElement } from "platejs";
import type { PlateEditor } from "platejs/react";

/** Where an insert should happen, captured before a file picker opens. */
export type CommentInsertPoint = {
	at: Path;
	/** True when `at` points at the empty paragraph that should be replaced. */
	replaceEmpty: boolean;
};

/** True when the path is an empty top level paragraph. */
function isEmptyRootParagraph(editor: PlateEditor, path: Path): boolean {
	if (path.length !== 1) return false;

	const node = editor.api.node(path)?.[0];

	return (
		ElementApi.isElement(node) &&
		node.type === editor.getType(KEYS.p) &&
		editor.api.string(path).trim().length === 0
	);
}

/** Resolve the insertion block for the current selection. */
export function resolveCommentInsertPoint(
	editor: PlateEditor,
): CommentInsertPoint {
	const selection = editor.selection;
	const block = selection
		? editor.api.above({
				at: selection,
				match: (node) => editor.api.isBlock(node),
			})
		: undefined;

	const blockPath = block?.[1];

	if (!blockPath) {
		// No selection means append at the end. The path may be one past the
		// last child, which `insertNodes` accepts as an append.
		return { at: [editor.children.length], replaceEmpty: false };
	}

	const rootPath: Path = [blockPath[0] ?? 0];

	if (isEmptyRootParagraph(editor, rootPath)) {
		return { at: rootPath, replaceEmpty: true };
	}

	return { at: PathApi.next(rootPath), replaceEmpty: false };
}

/**
 * Re-check a captured point after an async upload.
 *
 * The document can change while a file is uploading. Re-reading emptiness is
 * what stops the tool from deleting a paragraph the writer has since filled in.
 */
function resolveTarget(
	editor: PlateEditor,
	point: CommentInsertPoint,
): CommentInsertPoint {
	if (!editor.api.node(point.at)) {
		return resolveCommentInsertPoint(editor);
	}

	return {
		at: point.at,
		replaceEmpty: isEmptyRootParagraph(editor, point.at),
	};
}

/** Insert a paragraph below a new void block when there is nothing after it. */
function ensureParagraphAfter(editor: PlateEditor, at: Path): void {
	const after = PathApi.next(at);

	if (!editor.api.node(after)) {
		editor.tf.insertNodes(
			{ type: "p", children: [{ text: "" }] },
			{ at: after },
		);
	}
}

/** Insert one block node and leave the caret on the line below it. */
export function insertCommentBlock(
	editor: PlateEditor,
	point: CommentInsertPoint,
	node: TElement,
): void {
	const target = resolveTarget(editor, point);

	editor.tf.withoutNormalizing(() => {
		if (target.replaceEmpty) editor.tf.removeNodes({ at: target.at });

		editor.tf.insertNodes(node, { at: target.at });
		ensureParagraphAfter(editor, target.at);
	});

	const below = editor.api.start(PathApi.next(target.at));
	if (below) editor.tf.select(below);

	editor.tf.focus();
}

/** Insert a 3 by 3 table with a header row and leave the caret below it. */
export function insertCommentTable(
	editor: PlateEditor,
	point: CommentInsertPoint,
): void {
	const target = resolveTarget(editor, point);

	editor.tf.withoutNormalizing(() => {
		if (target.replaceEmpty) editor.tf.removeNodes({ at: target.at });

		insertTable(
			editor,
			{ rowCount: 3, colCount: 3, header: true },
			{ at: target.at, select: true },
		);

		ensureParagraphAfter(editor, target.at);
	});

	const below = editor.api.start(PathApi.next(target.at));
	if (below) editor.tf.select(below);

	editor.tf.focus();
}
