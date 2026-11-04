"use client";

/**
 * Which edge of a block the last pointer press landed on.
 *
 * Why this exists: a block level void element is atomic, so there is no caret
 * inside it. Clicking the left edge is the writer asking for a line above the
 * block, and clicking the right edge is asking for a line below it. The block
 * selection alone cannot express that, so the pressed side is stored on the
 * editor and read by the break handler.
 *
 * The stored path is part of the state on purpose. A stale side from an older
 * click must not change what Enter does on a different block, so the break
 * handler only uses the value when the currently selected block is the one the
 * pointer pressed.
 *
 * Used by: editor-kit.tsx, editor-image.tsx, editor-bookmark.tsx and
 * editor-table.tsx.
 */

import { cn } from "cn";
import { type Path, PathApi, type TElement } from "platejs";
import {
	createPlatePlugin,
	type PlateEditor,
	useEditorRef,
	usePluginOption,
	useSelected,
} from "platejs/react";
import type { MouseEvent } from "react";

/** The two sides a block edge can represent. */
export type BlockSide = "before" | "after";

/** Editor state for the last edge press. */
export const BlockSidePlugin = createPlatePlugin({
	key: "milestoneBlockSide",
	options: {
		side: null as BlockSide | null,
		path: null as Path | null,
	},
});

/**
 * Which side of an element a pointer press landed on.
 *
 * `edgePx` is capped at a third of the width so a narrow block still has a
 * usable middle zone instead of becoming all edge.
 */
export function sideFromPointer(
	clientX: number,
	element: HTMLElement,
	edgePx: number,
): BlockSide | null {
	const rect = element.getBoundingClientRect();

	if (rect.width <= 0) return null;

	const edge = Math.min(edgePx, rect.width / 3);
	const x = clientX - rect.left;

	if (x <= edge) return "before";
	if (x >= rect.width - edge) return "after";

	return null;
}

/**
 * Handle a press on the edge of a block.
 *
 * Returns true when the press was an edge press and has been consumed. The
 * caller can then skip its own behaviour. A middle press returns false and is
 * left completely untouched.
 *
 * `preventDefault` matters here: without it the browser would still move the
 * DOM selection and the block selection would fight it.
 */
export function beginBlockSide(
	editor: PlateEditor,
	element: TElement,
	event: MouseEvent<HTMLElement>,
	edgePx: number,
): boolean {
	const target = event.target as HTMLElement | null;

	// A press inside a control or a resize handle belongs to that control, not
	// to the block edge. Without this, clicking a caption or a resize bar would
	// select the block and swallow the interaction.
	if (
		target?.closest("textarea, input, button, select, [data-block-side-ignore]")
	) {
		return false;
	}

	const side = sideFromPointer(event.clientX, event.currentTarget, edgePx);

	if (!side) return false;

	const path = editor.api.findPath(element);

	if (!path) return false;

	event.preventDefault();
	event.stopPropagation();

	editor.setOption(BlockSidePlugin, "side", side);
	editor.setOption(BlockSidePlugin, "path", path);
	editor.tf.select(path);
	editor.tf.focus();

	return true;
}

/** Clear the stored side. Called once the break handler has used it. */
export function clearBlockSide(editor: PlateEditor): void {
	editor.setOption(BlockSidePlugin, "side", null);
	editor.setOption(BlockSidePlugin, "path", null);
}

/** True when the stored side belongs to the block at this path. */
export function isBlockSideFor(editor: PlateEditor, path: Path): boolean {
	const stored = editor.getOption(BlockSidePlugin, "path");

	return stored !== null && PathApi.equals(stored, path);
}

/**
 * A two pixel line on the side that Enter will insert towards.
 *
 * Why: the block selection looks identical whichever edge was pressed, so the
 * writer has no way to know whether Enter will open a line above or below. The
 * line is decorative only and never intercepts the pointer.
 */
export function BlockSideIndicator({ element }: { element: TElement }) {
	const editor = useEditorRef();
	const selected = useSelected();
	const side = usePluginOption(BlockSidePlugin, "side");
	const storedPath = usePluginOption(BlockSidePlugin, "path");

	if (!selected || !side || !storedPath) return null;

	const path = editor.api.findPath(element);

	if (!path || !PathApi.equals(path, storedPath)) return null;

	return (
		<span
			aria-hidden
			className={cn(
				"pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-app-focus",
				side === "before" ? "-top-0.5" : "-bottom-0.5",
			)}
		/>
	);
}
