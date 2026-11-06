"use client";

/**
 * The floating formatting toolbar shown over a text selection.
 *
 * Why it floats instead of sitting in a fixed header: the description is a
 * short brief, and a permanent toolbar row competes with the text for space.
 * The bar follows the selection, which is the Medium and Notion behaviour most
 * people expect from a rich text field.
 *
 * The positioning and open/close rules come from `@platejs/floating`, which
 * also handles the hard parts: hiding while the mouse is still down, keeping
 * the bar open while the selection exists, and following the selection on
 * scroll and resize.
 *
 * Every button calls the shared actions in editor-actions.ts, so the context
 * menu exposes exactly the same commands.
 *
 * Used by: features/milestones/editor/milestone-editor.tsx.
 */

import {
	FloatingPortal,
	flip,
	offset,
	useFloatingToolbar,
	useFloatingToolbarState,
} from "@platejs/floating";
import { triggerFloatingLinkInsert } from "@platejs/link/react";
import {
	BoldIcon,
	CodeIcon,
	IndentDecreaseIcon,
	IndentIncreaseIcon,
	ItalicIcon,
	LinkIcon,
	ListIcon,
	ListOrderedIcon,
	ListTodoIcon,
	StrikethroughIcon,
	UnderlineIcon,
} from "lucide-react";
import { useEditorId, useEditorRef, useEventEditorValue } from "platejs/react";

import { type EditorFormatAction, runFormatAction } from "./editor-actions";
import {
	BlockSelect,
	ListButton,
	MarkButton,
	ToolbarButton,
	ToolbarSeparator,
} from "./editor-toolbar-primitives";

/** Indent or outdent the selected blocks. */
function IndentButton({ reverse }: { reverse: boolean }) {
	const editor = useEditorRef();
	const action: EditorFormatAction = { type: "indent", reverse };

	return (
		<ToolbarButton
			label={reverse ? "Outdent" : "Indent"}
			onPress={() => runFormatAction(editor, action)}
		>
			{reverse ? (
				<IndentDecreaseIcon aria-hidden />
			) : (
				<IndentIncreaseIcon aria-hidden />
			)}
		</ToolbarButton>
	);
}

export function EditorFloatingToolbar() {
	const editorId = useEditorId();
	const focusedEditorId = useEventEditorValue("focus");
	const editor = useEditorRef();

	const state = useFloatingToolbarState({
		editorId,
		focusedEditorId,
		floatingOptions: {
			placement: "top",
			middleware: [
				offset(8),
				flip({
					padding: 12,
					fallbackPlacements: [
						"top-start",
						"top-end",
						"bottom-start",
						"bottom-end",
					],
				}),
			],
		},
	});
	const {
		clickOutsideRef,
		hidden,
		props: rootProps,
		ref: floatingRef,
	} = useFloatingToolbar(state);

	return (
		<>
			{/* Kept mounted even while hidden, otherwise opening the link prompt
			    (which hides the bar) would unmount the dialog in the same pass. */}
			{!hidden && (
				<FloatingPortal>
					<div ref={clickOutsideRef}>
						<div
							{...rootProps}
							ref={floatingRef}
							role="toolbar"
							aria-label="Text formatting"
							className="ignore-click-outside/toolbar flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 border border-app-border bg-app-panel p-1 shadow-md"
						>
							<BlockSelect />

							<ToolbarSeparator />

							<MarkButton mark="bold" label="Bold">
								<BoldIcon aria-hidden />
							</MarkButton>
							<MarkButton mark="italic" label="Italic">
								<ItalicIcon aria-hidden />
							</MarkButton>
							<MarkButton mark="underline" label="Underline">
								<UnderlineIcon aria-hidden />
							</MarkButton>
							<MarkButton mark="strikethrough" label="Strikethrough">
								<StrikethroughIcon aria-hidden />
							</MarkButton>
							<MarkButton mark="code" label="Inline code">
								<CodeIcon aria-hidden />
							</MarkButton>

							<ToolbarSeparator />

							<ListButton list="ul" label="Bulleted list">
								<ListIcon aria-hidden />
							</ListButton>
							<ListButton list="ol" label="Numbered list">
								<ListOrderedIcon aria-hidden />
							</ListButton>
							<ListButton list="taskList" label="Checklist">
								<ListTodoIcon aria-hidden />
							</ListButton>

							<ToolbarSeparator />

							<IndentButton reverse />
							<IndentButton reverse={false} />

							<ToolbarSeparator />

							<ToolbarButton
								label="Link"
								onPress={() =>
									triggerFloatingLinkInsert(editor, { focused: true })
								}
							>
								<LinkIcon aria-hidden />
							</ToolbarButton>
						</div>
					</div>
				</FloatingPortal>
			)}
		</>
	);
}
