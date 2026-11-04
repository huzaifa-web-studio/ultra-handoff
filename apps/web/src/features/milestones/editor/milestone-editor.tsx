"use client";

/**
 * The milestone rich text editor.
 *
 * Why two components: an editable body for staff, and a static render for a
 * client or an archived project. The static path never mounts Slate's editable
 * surface, so a read only viewer cannot type into a document they cannot save.
 *
 * The editable editor is keyed by milestone id by its parent. That remounts the
 * instance per milestone, which resets undo history and prevents `Ctrl+Z` from
 * restoring text from a different milestone.
 *
 * The value stays local to the editor while typing; the parent debounces the
 * save. Sending a new `initialValue` on every keystroke would fight the cursor.
 *
 * Tab and Shift+Tab are handled by the indent plugin registered in editor-kit,
 * so they indent and outdent the current block instead of leaving the field.
 * Escape blurs the editor, which keeps Tab from becoming a keyboard trap.
 *
 * There is no fixed toolbar. Formatting lives in the floating bar that follows
 * a text selection, which keeps the surface quiet until the writer needs it.
 *
 * Used by: features/milestones/milestone-detail-panel.tsx.
 */

import type { Value } from "platejs";
import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { PlateStatic } from "platejs/static";
import { type KeyboardEvent, useState } from "react";

import { LinkPreviewProvider } from "#/features/link-previews/link-preview-context";
import { extractLinkUrls } from "#/features/link-previews/utils";
import { BlockMenuProvider } from "./editor-draggable";
import {
	EMPTY_EDITOR_VALUE,
	milestoneEditorPlugins,
	milestoneStaticEditorPlugins,
} from "./editor-kit";
import { EditorFloatingToolbar } from "./editor-toolbar";
import { EditorStaticProvider } from "./editor-view-context";

/**
 * Normalise a stored body into something Slate can mount.
 *
 * The clone is not optional: Slate mutates its `children` array while typing,
 * and the stored value lives in the React Query cache. Handing that array over
 * directly would edit the cache in place and make a discarded draft look saved.
 */
function toEditorValue(value: unknown[]): Value {
	if (value.length === 0) return structuredClone(EMPTY_EDITOR_VALUE) as Value;

	return structuredClone(value) as Value;
}

/**
 * Let keyboard users leave the editor.
 *
 * Tab is now claimed for block indentation, so Escape is the documented way
 * out. Blurring hands focus back to the document, where Tab moves to the next
 * control again, which is what keeps the editor from being a keyboard trap.
 */
function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
	if (event.key !== "Escape") return;
	if (event.metaKey || event.ctrlKey || event.altKey) return;

	event.currentTarget.blur();
}

export function MilestoneEditor({
	initialValue,
	onChange,
	readOnly = false,
	ariaLabel,
	organizationId,
	organizationSlug,
}: {
	initialValue: unknown[];
	onChange: (value: unknown[]) => void;
	readOnly?: boolean;
	ariaLabel: string;
	/** Where an inline image is stored. Omit to hide the image item. */
	organizationId?: string;
	organizationSlug?: string;
}) {
	// Created once for this mounted instance. The parent key handles resets.
	const editor = usePlateEditor({
		plugins: milestoneEditorPlugins,
		value: toEditorValue(initialValue),
		// Run the table normalizer on mount, so an existing table that ends the
		// description already has the paragraph the caret needs below it.
		shouldNormalizeEditor: true,
	});

	// The set of links in the body decides which previews are worth asking
	// about. Keeping it in state means the provider only re-renders when the
	// set actually changes, not on every keystroke.
	const [previewUrls, setPreviewUrls] = useState(() =>
		extractLinkUrls(initialValue),
	);

	function handleChange(value: unknown[]) {
		onChange(value);

		const next = extractLinkUrls(value);
		setPreviewUrls((current) => {
			if (current.length === next.length) {
				let same = true;

				for (let index = 0; index < current.length; index += 1) {
					if (current[index] !== next[index]) {
						same = false;
						break;
					}
				}

				if (same) return current;
			}

			return next;
		});
	}

	return (
		<LinkPreviewProvider orgSlug={organizationSlug ?? ""} urls={previewUrls}>
			<BlockMenuProvider
				organizationId={organizationId}
				organizationSlug={organizationSlug}
			>
				<Plate
					editor={editor}
					readOnly={readOnly}
					onChange={({ value }) => handleChange(value as unknown[])}
				>
					<PlateContent
						aria-label={ariaLabel}
						onKeyDown={handleEditorKeyDown}
						placeholder="Write the details, the expected outcome, or anything the assignee needs."
						// `disableDefaultStyles` removes Slate's `white-space: pre-wrap`, so
						// the editor has to restate it. Without it the browser collapses
						// spaces as they are typed and the text looks trimmed on screen.
						//
						// The left padding is the block gutter: 44px holds the insert
						// button and the drag handle.
						className="min-h-40 w-full cursor-text pl-11 pr-3 py-3 text-sm break-words whitespace-pre-wrap text-app-text outline-none [&_[data-slate-placeholder]]:text-app-text-muted [&_[data-slate-placeholder]]:opacity-100"
						disableDefaultStyles
					/>

					{/* The only formatting surface: it follows the text selection. */}
					{!readOnly && <EditorFloatingToolbar />}
				</Plate>
			</BlockMenuProvider>
		</LinkPreviewProvider>
	);
}

/**
 * A read only render of a stored body.
 *
 * `PlateStatic` renders the same node components without an editable surface,
 * so a client sees exactly the formatting the author used.
 */
export function MilestoneEditorStatic({
	value,
	ariaLabel,
	organizationSlug,
}: {
	value: unknown[];
	ariaLabel: string;
	/** Where the previews are read from. Omit to render links without cards. */
	organizationSlug?: string;
}) {
	const [initialValue] = useState(() => toEditorValue(value));
	const [previewUrls] = useState(() => extractLinkUrls(value));
	const editor = usePlateEditor({
		plugins: milestoneStaticEditorPlugins,
		value: initialValue,
	});

	return (
		<LinkPreviewProvider orgSlug={organizationSlug ?? ""} urls={previewUrls}>
			<EditorStaticProvider>
				<PlateStatic
					editor={editor}
					aria-label={ariaLabel}
					// Match the editable surface, so a body with deliberate spacing is
					// shown exactly as it was written.
					className="px-3 py-3 text-sm break-words whitespace-pre-wrap text-app-text"
				/>
			</EditorStaticProvider>
		</LinkPreviewProvider>
	);
}
