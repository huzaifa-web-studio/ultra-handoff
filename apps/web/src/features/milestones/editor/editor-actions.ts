"use client";

/**
 * Formatting actions used by the floating toolbar.
 *
 * Why this module: the bar renders several kinds of action through the same
 * small command shape. Keeping the transform calls here means the buttons stay
 * presentational and every action focuses the editor the same way.
 *
 * Used by: editor-toolbar.tsx.
 */

import { ListPlugin } from "@platejs/list-classic/react";
import type { PlateEditor } from "platejs/react";

/** One command either surface can run against the current selection. */
export type EditorFormatAction =
	| {
			type: "mark";
			mark: "bold" | "italic" | "underline" | "strikethrough" | "code";
	  }
	| { type: "block"; block: "p" | "h2" | "h3" | "blockquote" }
	| { type: "list"; list: "ul" | "ol" }
	| { type: "indent"; reverse: boolean };

/**
 * Run one formatting command and leave the editor focused.
 *
 * Focusing after the command matters for the floating bar: pressing a button
 * must not leave focus on the bar, because the writer has to keep typing as
 * soon as the action applies.
 */
export function runFormatAction(
	editor: PlateEditor,
	action: EditorFormatAction,
): void {
	switch (action.type) {
		case "mark":
			editor.tf.toggleMark(action.mark);
			break;
		case "block":
			editor.tf.toggleBlock(action.block);
			break;
		case "list":
			editor.getTransforms(ListPlugin).toggle.list({ type: action.list });
			break;
		case "indent":
			// Uses the tab transform so a list item nests or moves out instead of
			// being block indented.
			editor.tf.tab({ reverse: action.reverse });
			break;
	}

	editor.tf.focus();
}
