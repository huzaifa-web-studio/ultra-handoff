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
import { LinkPreviewProvider } from "#/features/link-previews/link-preview-context";
import { extractLinkUrls } from "#/features/link-previews/utils";
import { useMentionCandidates } from "#/features/milestones/comments/hooks";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { BlockMenuProvider } from "./editor-draggable";
import { EditorDropOverlay, useEditorFileDrop } from "./editor-file-drop";
import {
	milestoneEditorPlugins,
	milestoneStaticEditorPlugins,
} from "./editor-kit";
import { EditorFloatingToolbar } from "./editor-toolbar";
import { toEditorValue } from "./editor-value";
import { EditorStaticProvider } from "./editor-view-context";
import { MentionProvider } from "./mentions/mention-context";
import { mentionKey } from "./mentions/mention-key";
import {
	MENTION_PICKER_ID,
	type MentionPanelPosition,
	MentionPicker,
	type MentionPickerGroup,
	type MentionPickerItem,
} from "./mentions/mention-picker";

/** Current plain-text @query and the picker position near the caret. */
type MentionTrigger = { query: string; position: MentionPanelPosition };

/** Find a typed @query and use the caret rectangle to anchor its suggestions. */
function readMentionTrigger(
	editor: PlateEditor,
	fallback: DOMRect | null,
): MentionTrigger | null {
	if (
		typeof window === "undefined" ||
		!editor.selection ||
		!RangeApi.isCollapsed(editor.selection)
	)
		return null;
	const range = editor.api.range("start", editor.selection);
	if (!range) return null;
	const match = /(?:^|\s)@([^\s@]{0,64})$/.exec(editor.api.string(range));
	if (!match) return null;
	const selection = window.getSelection();
	const caret = selection?.rangeCount
		? selection.getRangeAt(0).getBoundingClientRect()
		: null;
	const anchor = caret && (caret.width || caret.height) ? caret : fallback;
	if (!anchor) return null;
	const gap = 6;
	const below = window.innerHeight - anchor.bottom - gap;
	const above = anchor.top - gap;
	const placeAbove = below < 288 && above > below;
	return {
		query: match[1] ?? "",
		position: {
			left: Math.max(gap, Math.min(anchor.left, window.innerWidth - 326)),
			...(placeAbove
				? {
						bottom: window.innerHeight - anchor.top + gap,
						maxHeight: Math.max(96, above),
					}
				: { top: anchor.bottom + gap, maxHeight: Math.max(96, below) }),
		},
	};
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
	projectId,
}: {
	initialValue: unknown[];
	onChange: (value: unknown[]) => void;
	readOnly?: boolean;
	ariaLabel: string;
	/** Where an inline image is stored. Omit to hide the image item. */
	organizationId?: string;
	organizationSlug?: string;
	/** Project that scopes the visible mention suggestions. */
	projectId: string;
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
	const [mention, setMention] = useState<MentionTrigger | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);
	const pickerRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const search = useDebouncedValue(mention?.query ?? "", 220);
	const candidates = useMentionCandidates(
		organizationSlug ?? "",
		projectId,
		search,
		Boolean(mention) && !readOnly,
	);
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
	// Reset the keyboard highlight only when the suggestion identities change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset for a new suggestion result set
	useEffect(() => setActiveIndex(0), [itemSignature]);
	const refreshMention = useCallback(() => {
		setMention(
			readOnly
				? null
				: readMentionTrigger(
						editor,
						contentRef.current?.getBoundingClientRect() ?? null,
					),
		);
	}, [editor, readOnly]);
	const chooseMention = useCallback(
		(item: MentionPickerItem) => {
			const trigger = readMentionTrigger(
				editor,
				contentRef.current?.getBoundingClientRect() ?? null,
			);
			if (!trigger || !editor.selection) return setMention(null);
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
				const entry = editor.api.above({
					match: (node) =>
						ElementApi.isElement(node) && node.type === "mention",
				});
				if (entry) {
					const after = PathApi.next(entry[1]);
					if (!editor.api.node(after))
						editor.tf.insertNodes({ text: " " }, { at: after });
					const point = editor.api.start(after);
					if (point) editor.tf.select(point);
				}
			});
			setMention(null);
			editor.tf.focus();
		},
		[editor],
	);

	// A milestone description accepts images and the same documents a comment
	// does. Both purposes are milestone scoped, so an attached file can never be
	// confused with a discussion attachment.
	const drop = useEditorFileDrop(editor, {
		organizationId,
		organizationSlug,
		imagePurpose: "milestone-image",
		filePurpose: "milestone-file",
		disabled: readOnly,
	});

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
			<MentionProvider value={{ orgSlug: organizationSlug ?? "", projectId }}>
				<BlockMenuProvider
					organizationId={organizationId}
					organizationSlug={organizationSlug}
				>
					<Plate
						editor={editor}
						readOnly={readOnly}
						onChange={({ value }) => {
							handleChange(value as unknown[]);
							refreshMention();
						}}
						onSelectionChange={refreshMention}
						onValueChange={refreshMention}
					>
						<fieldset
							className="relative m-0 min-w-0 border-0 p-0"
							onKeyDownCapture={(event) => {
								if (!mention || event.nativeEvent.isComposing) return;
								if (event.key === "Escape") {
									event.preventDefault();
									setMention(null);
									return;
								}
								if (items.length === 0) return;
								if (event.key === "ArrowDown" || event.key === "ArrowUp") {
									event.preventDefault();
									setActiveIndex(
										(current) =>
											(current +
												(event.key === "ArrowDown" ? 1 : -1) +
												items.length) %
											items.length,
									);
									return;
								}
								if (
									event.key === "Enter" &&
									!event.shiftKey &&
									!event.ctrlKey &&
									!event.metaKey
								) {
									event.preventDefault();
									const item = items[activeIndex] ?? items[0];
									if (item) chooseMention(item);
								}
							}}
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
									{...drop.dropProps}
									onKeyUp={refreshMention}
									onMouseUp={refreshMention}
								/>

								<EditorDropOverlay
									visible={drop.isDragging}
									label="Drop to add an image or a file"
								/>
							</div>

							{/* The only formatting surface: it follows the text selection. */}
							{!readOnly && <EditorFloatingToolbar />}
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
					</Plate>
				</BlockMenuProvider>
			</MentionProvider>
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
				<MentionProvider
					value={{ orgSlug: organizationSlug ?? "", projectId: "" }}
				>
					<PlateStatic
						editor={editor}
						aria-label={ariaLabel}
						// Match the editable surface, so a body with deliberate spacing is
						// shown exactly as it was written.
						className="px-3 py-3 text-sm break-words whitespace-pre-wrap text-app-text"
					/>
				</MentionProvider>
			</EditorStaticProvider>
		</LinkPreviewProvider>
	);
}
