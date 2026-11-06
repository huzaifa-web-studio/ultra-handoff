"use client";

/**
 * Block insertion helpers for the comment editor.
 *
 * Why this exists: the comment composer has no block gutter, so images, files
 * and tables are inserted from the bottom toolbar. A toolbar has a selection,
 * not a block, so the helpers turn the selection into the block path the
 * insertion should use.
 *
 * The rule itself lives in editor-insert.ts, because the milestone gutter and
 * the file drop handler follow the same three rules. This file only keeps the
 * comment specific names and the table variant.
 *
 * Used by: comments/editor/comment-toolbar.tsx.
 */

import { insertTable } from "@platejs/table";
import { PathApi, type TElement } from "platejs";
import type { PlateEditor } from "platejs/react";

import {
	type EditorInsertPoint,
	ensureParagraphAfter,
	insertVoidBlock,
	refreshInsertPoint,
	resolveInsertPoint,
} from "#/components/rich-text/editor-insert";

/** Where an insert should happen, captured before a file picker opens. */
export type CommentInsertPoint = EditorInsertPoint;

/** Resolve the insertion block for the current selection. */
export function resolveCommentInsertPoint(
	editor: PlateEditor,
): CommentInsertPoint {
	return resolveInsertPoint(editor);
}

/** Insert one block node and leave the caret on the line below it. */
export function insertCommentBlock(
	editor: PlateEditor,
	point: CommentInsertPoint,
	node: TElement,
): void {
	insertVoidBlock(editor, point, node);
}

/** Insert a 3 by 3 table with a header row and leave the caret below it. */
export function insertCommentTable(
	editor: PlateEditor,
	point: CommentInsertPoint,
): void {
	const target = refreshInsertPoint(editor, point);

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
