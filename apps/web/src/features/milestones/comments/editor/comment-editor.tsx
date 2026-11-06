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
 *   - while the mention picker is open, Enter selects, the arrow keys move the
 *     highlight and Escape closes the picker without cancelling the reply
 *
 * Used by: comments/comment-composer.tsx and comments/comment-item.tsx.
 */

import { ElementApi, PathApi, RangeApi } from "platejs";
import {
	Plate,
	PlateContent,
	type PlateEditor,
	usePlateEditor,
} from "platejs/react";
import { PlateStatic } from "platejs/static";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	EditorDropOverlay,
	useEditorFileDrop,
} from "#/components/rich-text/editor-file-drop";
import { toEditorValue } from "#/components/rich-text/editor-value";
import { EditorStaticProvider } from "#/components/rich-text/editor-view-context";
import { LinkPreviewProvider } from "#/features/link-previews/link-preview-context";
import { extractLinkUrls } from "#/features/link-previews/utils";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { CommentChecklistProvider } from "../comment-checklist";
import { useMentionCandidates } from "../hooks";
import {
	commentEditorPlugins,
	commentStaticEditorPlugins,
} from "./comment-kit";
import { useMentionContext } from "./mention-context";
import { mentionKey } from "./mention-key";
import {
	MENTION_PICKER_ID,
	type MentionPanelPosition,
	MentionPicker,
	type MentionPickerGroup,
	type MentionPickerItem,
} from "./mention-picker";

/** Run the submit action without letting the browser or Slate also handle it. */
function handleShortcut(
	event: KeyboardEvent<HTMLElement>,
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

/** Where the picker should render and what the writer has typed after `@`. */
type MentionTrigger = {
	query: string;
	position: MentionPanelPosition;
};

/** Size and gap of the picker, used to place it above or below the caret. */
const MENTION_PANEL_WIDTH = 320;
const MENTION_PANEL_HEIGHT = 288;
const MENTION_PANEL_GAP = 6;

/**
 * Read an `@query` trigger from the text immediately before the caret.
 *
 * Why read the editor text instead of the DOM: `editor.api.string` treats inline
 * void nodes as empty and returns the real text of the block, so a chip earlier
 * on the line cannot confuse the match. The DOM is used only for the caret
 * rectangle that positions the panel.
 *
 * The trigger is ordinary text. Nothing is inserted into the document until the
 * writer chooses a suggestion, which is why typing keeps working and a plain `@`
 * stays a plain `@`.
 */
function readMentionTrigger(
	editor: PlateEditor,
	fallbackRect: DOMRect | null,
): MentionTrigger | null {
	if (typeof window === "undefined") return null;

	const selection = editor.selection;
	if (!selection || !RangeApi.isCollapsed(selection)) return null;

	// A trigger can span a line break, but not a different block.
	const range = editor.api.range("start", selection);
	if (!range) return null;

	const textBefore = editor.api.string(range);
	const match = /(?:^|\s)@([^\s@]{0,64})$/.exec(textBefore);
	if (!match) return null;

	const query = match[1] ?? "";

	// The caret rect is what anchors the popup. A collapsed range at the end of
	// a line can report an empty rect, so the editor itself is the fallback.
	const domSelection = window.getSelection();
	const domRange =
		domSelection && domSelection.rangeCount > 0
			? domSelection.getRangeAt(0)
			: null;
	const rawCaretRect = domRange?.getBoundingClientRect() ?? null;
	const caretRect =
		rawCaretRect && (rawCaretRect.width > 0 || rawCaretRect.height > 0)
			? rawCaretRect
			: null;
	const anchor = caretRect ?? fallbackRect;

	if (!anchor) return null;

	const spaceBelow = window.innerHeight - anchor.bottom - MENTION_PANEL_GAP;
	const spaceAbove = anchor.top - MENTION_PANEL_GAP;
	const left = Math.max(
		MENTION_PANEL_GAP,
		Math.min(
			Math.max(MENTION_PANEL_GAP, anchor.left),
			window.innerWidth - MENTION_PANEL_WIDTH - MENTION_PANEL_GAP,
		),
	);

	// Anchor the edge nearest the caret, never a guessed panel height. A short
	// list then sits right above or below the caret instead of leaving a gap.
	const placeAbove =
		spaceBelow < MENTION_PANEL_HEIGHT && spaceAbove > spaceBelow;

	const position: MentionPanelPosition = placeAbove
		? {
				left,
				bottom: window.innerHeight - anchor.top + MENTION_PANEL_GAP,
				maxHeight: Math.max(96, spaceAbove),
			}
		: {
				left,
				top: anchor.bottom + MENTION_PANEL_GAP,
				maxHeight: Math.max(96, spaceBelow),
			};

	return { query, position };
}

export function CommentEditor({
	initialValue,
	onChange,
	onSubmit,
	onCancel,
	ariaLabel,
	placeholder,
	organizationId,
	organizationSlug,
	autoFocus = false,
	focusToken = 0,
	readOnly = false,
	minHeightClass = "min-h-16",
	footer,
	onUploadingChange,
}: {
	initialValue: unknown[];
	onChange: (value: unknown[]) => void;
	onSubmit?: () => void;
	onCancel?: () => void;
	ariaLabel: string;
	placeholder: string;
	/** Tenant that owns a dropped or picked upload. */
	organizationId: string;
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
	/** Lets the host disable Post or Save while a drop uploads. */
	onUploadingChange?: (uploading: boolean) => void;
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

	// Mention trigger state. The `@query` lives in the editor as ordinary text;
	// this only records that a picker should be shown and where.
	const mentionContext = useMentionContext();
	const [mention, setMention] = useState<MentionTrigger | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const pickerRef = useRef<HTMLDivElement>(null);
	const wrapperRef = useRef<HTMLFieldSetElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	const search = mention?.query ?? "";
	const debouncedSearch = useDebouncedValue(search, 220);

	const candidates = useMentionCandidates(
		mentionContext?.orgSlug ?? organizationSlug,
		mentionContext?.projectId ?? "",
		debouncedSearch,
		Boolean(mention) && !readOnly,
	);

	/**
	 * Recompute the trigger after every editor change.
	 *
	 * The watcher inside the Plate provider calls this on typing, deleting and
	 * caret movement, so the picker closes when the writer moves away from the
	 * `@` and reopens when they move back. It runs after the DOM selection has
	 * settled, which is when the caret rectangle is reliable.
	 */
	const refreshMention = useCallback(() => {
		if (readOnly) {
			setMention(null);
			return;
		}

		setMention(
			readMentionTrigger(
				editor,
				contentRef.current?.getBoundingClientRect() ?? null,
			),
		);
	}, [editor, readOnly]);

	// Flatten the three API groups into rows the picker can render and the
	// keyboard handler can index into.
	const groups = useMemo<MentionPickerGroup[]>(() => {
		let index = 0;

		const users = (candidates.data?.users ?? []).map((person) => ({
			key: mentionKey("user", person.userId),
			value: person.name,
			type: "user" as const,
			index: index++,
		}));

		const projects = (candidates.data?.projects ?? []).map((project) => ({
			key: mentionKey("project", project.id),
			value: project.name,
			slug: project.slug,
			type: "project" as const,
			index: index++,
		}));

		const milestones = (candidates.data?.milestones ?? []).map((milestone) => ({
			key: mentionKey("milestone", milestone.id),
			value: milestone.title,
			slug: milestone.projectSlug,
			type: "milestone" as const,
			secondary: milestone.projectName,
			index: index++,
		}));

		return [
			{ label: "People", items: users },
			{ label: "Projects", items: projects },
			{ label: "Milestones", items: milestones },
		];
	}, [candidates.data]);

	const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
	const itemSignature = items.map((item) => item.key).join("|");

	// A new result set means the old highlight is meaningless. The signature is
	// the dependency; the effect only resets state.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the result set changes
	useEffect(() => {
		setActiveIndex(0);
	}, [itemSignature]);

	/**
	 * Replace the typed `@query` with a mention chip.
	 *
	 * The text is deleted from the caret backwards, so the trigger does not need
	 * a Slate path for every character. The distance is read again here instead
	 * of trusting the state, which keeps a fast keystroke followed by Enter from
	 * deleting one character too few.
	 */
	const chooseMention = useCallback(
		(item: MentionPickerItem) => {
			const trigger = readMentionTrigger(
				editor,
				contentRef.current?.getBoundingClientRect() ?? null,
			);

			if (!trigger || !editor.selection) {
				setMention(null);
				return;
			}

			const selection = editor.selection;

			editor.tf.withoutNormalizing(() => {
				editor.tf.delete({
					at: selection,
					unit: "character",
					reverse: true,
					distance: trigger.query.length + 1,
				});

				editor.tf.insertNodes({
					type: "mention",
					key: item.key,
					value: item.value,
					...(item.slug ? { slug: item.slug } : {}),
					children: [{ text: "" }],
				});

				/**
				 * Move the caret to the text after the chip.
				 *
				 * `insertNodes` can leave the selection inside the void node. A void
				 * node is not editable, so typing there does nothing until the user
				 * clicks the editor again. Finding the chip we just inserted and
				 * selecting the next sibling fixes that.
				 */
				const mentionEntry = editor.api.above({
					match: (node) =>
						ElementApi.isElement(node) && node.type === "mention",
				});

				if (mentionEntry) {
					const afterPath = PathApi.next(mentionEntry[1]);

					// A chip at the end of the line needs a text node after it, both
					// as a caret home and as the space that lets writing continue.
					if (!editor.api.node(afterPath)) {
						editor.tf.insertNodes({ text: " " }, { at: afterPath });
					}

					const afterPoint = editor.api.start(afterPath);
					if (afterPoint) editor.tf.select(afterPoint);
				}
			});

			setMention(null);
			setActiveIndex(0);
			editor.tf.focus();
		},
		[editor],
	);

	/**
	 * Handle a key while the picker is open.
	 *
	 * Returns true when the key belonged to the picker, so the submit shortcut
	 * and Slate never also see it.
	 */
	function handleMentionKey(event: KeyboardEvent<HTMLElement>): boolean {
		// Real form fields inside the editor tree (link prompt, caption) own their
		// own keys. A mention picker must never intercept them.
		const target = event.target as HTMLElement | null;

		if (
			target &&
			(target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT")
		) {
			return false;
		}

		if (!mention) return false;
		if (event.nativeEvent.isComposing) return false;

		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			setMention(null);
			return true;
		}

		if (items.length === 0) return false;

		if (event.key === "ArrowDown") {
			event.preventDefault();
			event.stopPropagation();
			setActiveIndex((current) => (current + 1) % items.length);
			return true;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			event.stopPropagation();
			setActiveIndex((current) => (current - 1 + items.length) % items.length);
			return true;
		}

		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey
		) {
			event.preventDefault();
			event.stopPropagation();

			const item = items[activeIndex] ?? items[0];

			if (item) chooseMention(item);
			return true;
		}

		return false;
	}

	// A floating panel anchored to old coordinates is worse than none, so any
	// scroll closes it. Capture catches the comment list and the page alike.
	useEffect(() => {
		if (!mention) return;

		const close = (event: Event) => {
			// Scrolling inside the picker must not close it. Scroll does not
			// bubble, so the window listener is in the capture phase.
			const target = event.target;

			if (target instanceof Node && pickerRef.current?.contains(target)) {
				return;
			}

			setMention(null);
		};

		window.addEventListener("scroll", close, true);

		return () => window.removeEventListener("scroll", close, true);
	}, [mention]);

	// A click outside the editor and the picker dismisses it. Clicks on a row
	// are inside the picker, so they survive until the row's own handler runs.
	useEffect(() => {
		if (!mention) return;

		function onPointerDown(event: PointerEvent) {
			const target = event.target;

			if (!(target instanceof Node)) return;
			if (pickerRef.current?.contains(target)) return;
			if (wrapperRef.current?.contains(target)) return;

			setMention(null);
		}

		document.addEventListener("pointerdown", onPointerDown);

		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [mention]);

	function handleChange(value: unknown[]) {
		onChange(value);

		const next = extractLinkUrls(value);
		setPreviewUrls((current) => (sameUrls(current, next) ? current : next));
	}

	// A comment accepts images and documents, matching the two comment upload
	// policies. A file dropped while a save is pending is ignored, because the
	// editable is read only at that moment.
	const drop = useEditorFileDrop(editor, {
		organizationId,
		organizationSlug,
		imagePurpose: "comment-image",
		filePurpose: "comment-file",
		disabled: readOnly,
		onUploadingChange,
	});

	return (
		<LinkPreviewProvider orgSlug={organizationSlug} urls={previewUrls}>
			<fieldset
				ref={wrapperRef}
				aria-label="Comment editor"
				className="m-0 min-w-0 border-0 p-0"
				onKeyDownCapture={(event) => {
					if (handleMentionKey(event)) return;
					handleShortcut(event, onSubmit, onCancel);
				}}
				onBlur={(event) => {
					const next = event.relatedTarget;

					// Moving into the picker is not leaving the editor, so the
					// trigger survives a click on a row.
					if (next instanceof Node && pickerRef.current?.contains(next)) {
						return;
					}

					setMention(null);
				}}
			>
				<Plate
					editor={editor}
					readOnly={readOnly}
					onChange={({ value }) => handleChange(value as unknown[])}
					onSelectionChange={() => refreshMention()}
					onValueChange={() => refreshMention()}
				>
					<div ref={contentRef} className="relative">
						<PlateContent
							aria-label={ariaLabel}
							aria-expanded={mention !== null}
							aria-controls={mention ? MENTION_PICKER_ID : undefined}
							aria-autocomplete="list"
							aria-activedescendant={
								mention && items[activeIndex]
									? `${MENTION_PICKER_ID}-${items[activeIndex].index}`
									: undefined
							}
							placeholder={placeholder}
							autoFocus={autoFocus}
							// `disableDefaultStyles` removes Slate's `white-space: pre-wrap`,
							// so the editor restates it. Without it the browser collapses
							// spaces as they are typed and the text looks trimmed on screen.
							className={`${minHeightClass} max-h-72 w-full cursor-text overflow-y-auto px-3 py-2 text-sm break-words whitespace-pre-wrap text-app-text outline-none [&_[data-slate-placeholder]]:text-app-text-muted [&_[data-slate-placeholder]]:opacity-100`}
							disableDefaultStyles
							onKeyUp={() => refreshMention()}
							onMouseUp={() => refreshMention()}
							{...drop.dropProps}
						/>

						<EditorDropOverlay
							visible={drop.isDragging}
							label="Drop to add an image or a file"
						/>
					</div>

					{footer}
				</Plate>

				{mention && (
					<MentionPicker
						groups={groups}
						activeIndex={activeIndex}
						loading={candidates.isPending || candidates.isFetching}
						hasMore={Boolean(
							candidates.data?.hasMore.users ||
								candidates.data?.hasMore.projects ||
								candidates.data?.hasMore.milestones,
						)}
						position={mention.position}
						pickerRef={pickerRef}
						onSelect={chooseMention}
						onHover={setActiveIndex}
					/>
				)}
			</fieldset>
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
