"use client";

/**
 * The comment rich text surface.
 *
 * Two components, for the same reason the milestone body has two: an editable
 * surface for composing and editing, and a static render for reading. The static
 * path never mounts a contenteditable, so a rendered comment cannot be typed
 * into by accident.
 *
 * The editor is deliberately the milestone kit minus drag and drop, plus an
 * attachment node. That gives comments the same link cards, images, tables,
 * bookmarks and formatting as the milestone description while keeping the
 * discussion free of draggable sections and the side insert menu.
 *
 * Keyboard contract:
 *   - Enter inserts a line break, because this is a message with paragraphs
 *   - Shift+Enter submits. Cmd/Ctrl+Enter still works as a desktop shortcut.
 *     Both are handled in the capture phase so Slate cannot insert a break
 *     first.
 *   - Escape cancels when the parent offers a cancel action, otherwise it
 *     blurs the editor so Tab starts moving again
 *
 * Used by: comments/comment-composer.tsx and comments/comment-item.tsx.
 */

import { Plate, PlateContent, usePlateEditor } from "platejs/react";
import { PlateStatic } from "platejs/static";
import { type KeyboardEvent, useEffect, useState } from "react";

import { LinkPreviewProvider } from "#/features/link-previews/link-preview-context";
import { extractLinkUrls } from "#/features/link-previews/utils";
import { toEditorValue } from "../../editor/editor-value";
import { EditorStaticProvider } from "../../editor/editor-view-context";
import { CommentChecklistProvider } from "../comment-checklist";
import {
	commentEditorPlugins,
	commentStaticEditorPlugins,
} from "./comment-kit";

/** Run the submit action without letting the browser or Slate also handle it. */
function handleShortcut(
	event: KeyboardEvent<HTMLDivElement>,
	onSubmit?: () => void,
	onCancel?: () => void,
): void {
	// The link prompt and the image caption are real form fields inside the
	// editor tree. Their Enter and Shift+Enter belong to them, not to the post.
	const target = event.target as HTMLElement | null;

	if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
		return;
	}

	// An input method may use Enter or Shift+Enter to pick a candidate. Never
	// submit while a composition is active.
	if (event.nativeEvent.isComposing) return;

	if (
		event.key === "Enter" &&
		(event.shiftKey || event.metaKey || event.ctrlKey)
	) {
		event.preventDefault();
		event.stopPropagation();
		onSubmit?.();
		return;
	}

	if (event.key !== "Escape") return;

	if (onCancel) {
		event.preventDefault();
		onCancel();
		return;
	}

	// Blur the editable so Escape is a documented way out of the field. Tab
	// claims indentation elsewhere, so this keeps the editor from trapping focus.
	(event.target as HTMLElement).blur();
}

/** True when two preview URL lists contain the same values in the same order. */
function sameUrls(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;

	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) return false;
	}

	return true;
}

export function CommentEditor({
	initialValue,
	onChange,
	onSubmit,
	onCancel,
	ariaLabel,
	placeholder,
	organizationSlug,
	autoFocus = false,
	focusToken = 0,
	readOnly = false,
	minHeightClass = "min-h-16",
	footer,
}: {
	initialValue: unknown[];
	onChange: (value: unknown[]) => void;
	onSubmit?: () => void;
	onCancel?: () => void;
	ariaLabel: string;
	placeholder: string;
	/** Where link preview cards are read from. */
	organizationSlug: string;
	autoFocus?: boolean;
	/**
	 * Bumped by the parent when Reply is pressed. Focusing through a token
	 * works even when the editor is already mounted, which `autoFocus` cannot.
	 */
	focusToken?: number;
	/** True while a save is in flight, so text typed after sending is not lost. */
	readOnly?: boolean;
	minHeightClass?: string;
	/**
	 * The action row. Rendered inside the Plate provider so formatting buttons
	 * can read the selection, and after the content so it sits at the bottom of
	 * the card exactly as the composer design requires.
	 */
	footer?: React.ReactNode;
}) {
	// Created once per mounted instance. The parent uses `key` to reset it after
	// a successful post, which is the only reliable way to clear undo history.
	const editor = usePlateEditor({
		plugins: commentEditorPlugins,
		value: toEditorValue(initialValue),
		shouldNormalizeEditor: true,
	});

	// A reply press should put the caret in the composer even though the editor
	// was already mounted and focused elsewhere.
	useEffect(() => {
		if (focusToken === 0) return;

		editor.tf.focus();
	}, [editor, focusToken]);

	// The set of links decides which previews are worth asking about. Keeping it
	// in state means the provider only re-renders when the set changes.
	const [previewUrls, setPreviewUrls] = useState(() =>
		extractLinkUrls(initialValue),
	);

	function handleChange(value: unknown[]) {
		onChange(value);

		const next = extractLinkUrls(value);
		setPreviewUrls((current) => (sameUrls(current, next) ? current : next));
	}

	return (
		<LinkPreviewProvider orgSlug={organizationSlug} urls={previewUrls}>
			<div
				onKeyDownCapture={(event) => handleShortcut(event, onSubmit, onCancel)}
			>
				<Plate
					editor={editor}
					readOnly={readOnly}
					onChange={({ value }) => handleChange(value as unknown[])}
				>
					<PlateContent
						aria-label={ariaLabel}
						placeholder={placeholder}
						autoFocus={autoFocus}
						// `disableDefaultStyles` removes Slate's `white-space: pre-wrap`,
						// so the editor restates it. Without it the browser collapses
						// spaces as they are typed and the text looks trimmed on screen.
						className={`${minHeightClass} max-h-72 w-full cursor-text overflow-y-auto px-3 py-2 text-sm break-words whitespace-pre-wrap text-app-text outline-none [&_[data-slate-placeholder]]:text-app-text-muted [&_[data-slate-placeholder]]:opacity-100`}
						disableDefaultStyles
					/>

					{footer}
				</Plate>
			</div>
		</LinkPreviewProvider>
	);
}

/**
 * A read only render of a stored comment body.
 *
 * `PlateStatic` walks the same node renderers without an editable surface, so a
 * reader sees exactly the formatting, images, tables, cards and attachments the
 * author used.
 */
export function CommentBody({
	value,
	ariaLabel,
	organizationSlug,
	canToggleChecklist,
	checklistPending,
	onToggleChecklist,
}: {
	value: unknown[];
	ariaLabel: string;
	organizationSlug: string;
	/** True when this viewer may tick a checklist item. */
	canToggleChecklist: boolean;
	/** True while a toggle is in flight for this comment. */
	checklistPending: boolean;
	onToggleChecklist: (itemId: string, checked: boolean) => Promise<void>;
}) {
	const [initialValue] = useState(() => toEditorValue(value));
	const [previewUrls] = useState(() => extractLinkUrls(value));
	const editor = usePlateEditor({
		plugins: commentStaticEditorPlugins,
		value: initialValue,
	});

	return (
		<LinkPreviewProvider orgSlug={organizationSlug} urls={previewUrls}>
			<CommentChecklistProvider
				value={{
					disabled: !canToggleChecklist || checklistPending,
					onToggle: onToggleChecklist,
				}}
			>
				<EditorStaticProvider>
					<PlateStatic
						editor={editor}
						aria-label={ariaLabel}
						className="text-sm break-words whitespace-pre-wrap text-app-text"
					/>
				</EditorStaticProvider>
			</CommentChecklistProvider>
		</LinkPreviewProvider>
	);
}
