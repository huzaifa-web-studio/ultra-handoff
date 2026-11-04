"use client";

/**
 * Shared node insertion for the rich text editors.
 *
 * Why this module: the milestone gutter, the comment toolbar, the file drop
 * handler and the reply composer all place a node at a known position, and they
 * must agree on how that position is resolved. Repeating the rules per surface
 * is how they drift apart.
 *
 * Two shapes are supported:
 *   - a void block, such as an image, a table or a bookmark, which owns its line
 *   - an inline node, such as an attachment chip, which flows inside text
 *
 * Block rules:
 *   - an empty top level paragraph is replaced, so a tool never leaves a blank
 *     line above the block it just added
 *   - anything else inserts after its top level block, so a table never lands
 *     inside a list item or another table
 *   - a paragraph is added below the new void block when it ends the document,
 *     so the caret always has somewhere to go
 *
 * Inline rules:
 *   - the node goes into the text at the caret, which is what lets the writer
 *     keep typing before and after it on the same line
 *   - with no usable caret a paragraph is created, so an attachment can always
 *     be placed
 *   - the caret is moved to the text after the node, never inside the void
 *
 * Used by: editor-file-drop.tsx, editor-draggable.tsx and
 * comments/editor/comment-insert.ts.
 */

import {
	ElementApi,
	KEYS,
	type Path,
	PathApi,
	type Point,
	RangeApi,
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

/** Text blocks that can carry inline content at the top level. */
const TEXT_BLOCK_TYPES = new Set(["p", "h2", "h3", "blockquote"]);

/** Snapshot the current selection so it can survive an async upload. */
export function captureEditorRange(editor: PlateEditor): TRange | null {
	const selection = editor.selection;

	if (!selection) return null;

	return {
		anchor: { ...selection.anchor, path: [...selection.anchor.path] },
		focus: { ...selection.focus, path: [...selection.focus.path] },
	};
}

/** True when an inline node can be inserted at a range. */
export function canInsertInlineAt(editor: PlateEditor, range: TRange): boolean {
	if (!editor.api.hasRange(range)) return false;

	// A point inside an existing inline node, such as a link or another chip,
	// has no room for a sibling there.
	const inline = editor.api.above({
		at: range,
		match: (node) => ElementApi.isElement(node) && !editor.api.isBlock(node),
	});

	if (inline) return false;

	const block = editor.api.above({
		at: range,
		match: (node) => editor.api.isBlock(node),
	});

	// A range that lands inside a void block has nowhere for an inline node to
	// live, so the caller has to create a paragraph instead.
	if (!block) return false;

	const [node] = block;

	return ElementApi.isElement(node) && !editor.api.isVoid(node);
}

/**
 * Insert an inline node at a text point and leave the caret after it.
 *
 * Why the ancestor walk: `select: true` selects the void node, which Slate
 * represents as a point inside its zero width text. Walking up to the inline
 * element is what makes the following text addressable without guessing the
 * insert index, which differs between a text edge and the middle.
 */
function insertInlineAtPoint(
	editor: PlateEditor,
	point: Point,
	node: TElement,
): void {
	editor.tf.insertNodes(node, { at: point, select: true });

	const inline = editor.selection
		? editor.api.above({
				at: editor.selection,
				match: (candidate) =>
					ElementApi.isElement(candidate) && !editor.api.isBlock(candidate),
			})
		: undefined;

	if (!inline) {
		editor.tf.focus();
		return;
	}

	const afterPath = PathApi.next(inline[1]);
	let after = editor.api.start(afterPath);

	// Normalisation normally keeps a text node after an inline node. If it has
	// not run yet, create one so the writer can keep typing.
	if (!after) {
		editor.tf.insertNodes({ text: "" }, { at: afterPath });
		after = editor.api.start(afterPath);
	}

	if (after) editor.tf.select(after);

	editor.tf.focus();
}

/**
 * Insert an inline node into the text at a range.
 *
 * With no usable range the selection is used, and with no selection at all the
 * node goes into a new or empty paragraph at the current block. This is the
 * path a drop, a picker upload and a reply all share.
 */
export function insertInlineNode(
	editor: PlateEditor,
	at: TRange | null,
	node: TElement,
): void {
	const range = at ?? editor.selection;

	if (range && canInsertInlineAt(editor, range)) {
		// A non collapsed range keeps its text and inserts at the active edge,
		// because replacing a selected paragraph with a chip is surprising.
		const point = RangeApi.isCollapsed(range) ? range.anchor : range.focus;
		insertInlineAtPoint(editor, point, node);
		return;
	}

	insertInlineInParagraph(editor, resolveInsertPoint(editor), node);
}

/**
 * Insert an inline node into a paragraph, creating one when needed.
 *
 * Used when the attachment has no text point to land on, for example when the
 * writer picks a file without placing a caret or drops it over an image.
 */
export function insertInlineInParagraph(
	editor: PlateEditor,
	point: EditorInsertPoint,
	node: TElement,
): void {
	const target = refreshInsertPoint(editor, point);
	const paragraphPath = target.replaceEmpty
		? target.at
		: PathApi.next(target.at);

	// An empty paragraph already exists, so the chip goes at its start rather
	// than leaving a blank line above it. Otherwise a fresh paragraph is added
	// after the block and the chip starts it.
	if (!target.replaceEmpty) {
		editor.tf.insertNodes(
			{ type: "p", children: [{ text: "" }] },
			{ at: paragraphPath },
		);
	}

	const start = editor.api.start(paragraphPath);

	if (start) {
		insertInlineAtPoint(editor, start, node);
		return;
	}

	// Extremely defensive: a paragraph with no children cannot be focused, so
	// append a usable one and retry.
	const fallbackAt: Path = [editor.children.length];
	editor.tf.insertNodes(
		{ type: "p", children: [{ text: "" }] },
		{ at: fallbackAt },
	);

	const fallback = editor.api.start(fallbackAt);
	if (fallback) insertInlineAtPoint(editor, fallback, node);
}

/**
 * Append an inline node to the end of a block's text.
 *
 * The block gutter has no caret, so a file chosen from the menu is appended to
 * the text the writer already wrote. A block that cannot hold text, such as an
 * image or a table, gets a fresh paragraph after it instead.
 */
export function insertInlineAtBlockEnd(
	editor: PlateEditor,
	element: TElement,
	path: Path,
	node: TElement,
): void {
	const anchor = editor.api.findPath(element) ?? path;

	if (TEXT_BLOCK_TYPES.has(element.type) && !editor.api.isVoid(element)) {
		const end = editor.api.end(anchor);

		// The end can sit inside an existing inline node when the paragraph
		// already ends with a chip. That point cannot host a sibling, so the
		// fallback below creates a fresh paragraph instead.
		if (end && canInsertInlineAt(editor, { anchor: end, focus: end })) {
			insertInlineNode(editor, { anchor: end, focus: end }, node);
			return;
		}
	}

	insertInlineInParagraph(
		editor,
		{ at: PathApi.next(anchor), replaceEmpty: false },
		node,
	);
}
