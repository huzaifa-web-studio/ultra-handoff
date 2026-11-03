"use client";

/**
 * The milestone editor plugin set.
 *
 * Why curated instead of a full kit: a milestone description is a short brief,
 * not a document. Every plugin adds bundle weight and another node type the
 * server sanitizer has to understand. This list is the smallest set that covers
 * writing a usable brief: structure, emphasis, lists and links.
 *
 * What is deliberately absent: audio, video, embeds, mentions, code blocks, AI
 * and collaboration. Images use the official media plugin with the app's own
 * renderer, which keeps the node tested without pulling in the whole media
 * kit. The sanitizer already refuses node types it does not know, so an old
 * document cannot smuggle one in.
 *
 * Used by: features/milestones/editor/milestone-editor.tsx.
 */

import {
	BlockquotePlugin,
	BoldPlugin,
	CodePlugin,
	H2Plugin,
	H3Plugin,
	ItalicPlugin,
	StrikethroughPlugin,
	UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { CaptionPlugin } from "@platejs/caption/react";
import { DndPlugin } from "@platejs/dnd";
import { IndentPlugin } from "@platejs/indent/react";
import { LinkRules } from "@platejs/link";
import { LinkPlugin } from "@platejs/link/react";
import {
	BulletedListRules,
	OrderedListRules,
	TaskListRules,
} from "@platejs/list-classic";
import {
	BulletedListPlugin,
	ListItemContentPlugin,
	ListItemPlugin,
	ListPlugin,
	NumberedListPlugin,
	TaskListPlugin,
} from "@platejs/list-classic/react";
import { BaseImagePlugin } from "@platejs/media";
import { ImagePlugin } from "@platejs/media/react";
import {
	TableCellHeaderPlugin,
	TableCellPlugin,
	TablePlugin,
	TableRowPlugin,
} from "@platejs/table/react";
import { KEYS, PathApi } from "platejs";
import { createPlatePlugin, ParagraphPlugin } from "platejs/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

import { BlockDraggable } from "./editor-draggable";
import {
	BlockquoteElement,
	BoldLeaf,
	BulletedListElement,
	CodeLeaf,
	H2Element,
	H3Element,
	ItalicLeaf,
	LinkElement,
	ListItemContentElement,
	ListItemElement,
	NumberedListElement,
	ParagraphElement,
	StrikethroughLeaf,
	TaskListElement,
	UnderlineLeaf,
} from "./editor-elements";
import { ImageElement, ImageElementStatic } from "./editor-image";
import { MediaPreviewDialog } from "./editor-media-preview";
import {
	TableCellElement,
	TableCellHeaderElement,
	TableElement,
	TableRowElement,
} from "./editor-table";

/**
 * Turn a bare domain into an https URL for autolinking.
 *
 * Why: Plate's default `isUrl` requires a scheme, so pasting `example.com`
 * leaves it as plain text. Returning the href here keeps the visible text as
 * typed while the anchor points at the secure URL.
 *
 * Returning undefined means "use the text unchanged", which is what a value
 * that already carries a scheme should do.
 */
function autolinkHref(text: string): string | undefined {
	const value = text.trim();

	if (value.length === 0) return undefined;
	// Already a full URL, mailto or tel. Let Plate validate it as is.
	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
	// A host with at least one dot, optionally with a path. No spaces allowed.
	if (!/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value)) {
		return undefined;
	}

	return `https://${value}`;
}

/**
 * Keeps an empty paragraph after a table that ends the document.
 *
 * Without it, a table is the final block and clicking in the empty space below
 * it has nowhere to place the caret. The paragraph gives the writer a normal
 * line to click or type on, and it is also the line the cursor lands on after
 * tabbing out of the last cell.
 */
const TrailingParagraphPlugin = createPlatePlugin({
	key: "milestoneTrailingParagraph",
}).overrideEditor(({ editor, tf: { normalizeNode } }) => ({
	transforms: {
		normalizeNode(entry, options) {
			const [node, path] = entry;

			if (
				path.length === 1 &&
				"type" in node &&
				node.type === editor.getType("table")
			) {
				const nextPath = PathApi.next(path);

				if (!editor.api.node(nextPath)) {
					editor.tf.insertNodes(
						{ type: "p", children: [{ text: "" }] },
						{ at: nextPath },
					);
					return;
				}
			}

			normalizeNode(entry, options);
		},
	},
}));

/**
 * Images use the official media plugin.
 *
 * `disableUploadInsert` is deliberate: the package's built in paste handler
 * stores a base64 data URL, which the milestone sanitizer refuses. Uploads go
 * through the plus menu and the presigned pipeline instead. Pasting an image
 * URL still works, because that is the media package's embed path.
 */
const MilestoneImagePlugin = ImagePlugin.configure({
	options: { disableUploadInsert: true },
	render: {
		afterEditable: MediaPreviewDialog,
		node: ImageElement,
	},
});

/** The plugins passed to `usePlateEditor`. */
export const milestoneEditorPlugins = [
	// Blocks
	ParagraphPlugin.withComponent(ParagraphElement),
	H2Plugin.withComponent(H2Element),
	H3Plugin.withComponent(H3Element),
	BlockquotePlugin.withComponent(BlockquoteElement),
	MilestoneImagePlugin,
	// Captions are stored on the image node. The renderer reveals the field
	// when the image is selected, so no floating caption button is needed.
	CaptionPlugin.configure({
		options: { query: { allow: [KEYS.img] } },
	}),

	// Block indentation. Ordered before the list plugin so the list handler
	// runs first and can nest a list item, then fall through to indentation.
	// The sanitizer only keeps `indent` on the block types listed here, so a
	// list keeps nesting structurally and plain text is never corrupted.
	//
	// The inject object spells out the default node props as well as the extra
	// block types, so the plugin keeps mapping `indent` to `marginLeft`.
	IndentPlugin.configure({
		inject: {
			isBlock: true,
			nodeProps: {
				nodeKey: "indent",
				styleKey: "marginLeft",
				transformNodeValue: ({ getOptions, nodeValue }) => {
					const { offset = 24, unit = "px" } = getOptions();
					return `${String(nodeValue * offset)}${unit}`;
				},
			},
			targetPlugins: ["p", "h2", "h3", "blockquote"],
		},
		options: { indentMax: 8, offset: 24, unit: "px" },
	}),

	// Lists. `ListPlugin` carries the normalisation and the toggle behaviour,
	// the two list plugins only register the wrappers. Without ListPlugin the
	// toolbar buttons render but the document never gains a list.
	ListPlugin.configure({
		inputRules: [
			BulletedListRules.markdown({ variant: "-" }),
			BulletedListRules.markdown({ variant: "*" }),
			OrderedListRules.markdown({ variant: "." }),
			OrderedListRules.markdown({ variant: ")" }),
			TaskListRules.markdown({ checked: false }),
			TaskListRules.markdown({ checked: true }),
		],
	}),
	BulletedListPlugin.withComponent(BulletedListElement),
	NumberedListPlugin.withComponent(NumberedListElement),
	TaskListPlugin.withComponent(TaskListElement),
	ListItemPlugin.withComponent(ListItemElement),
	ListItemContentPlugin.withComponent(ListItemContentElement),

	// Tables. A table is a block like any other, so it can be dragged as a
	// whole and saved with the rest of the body.
	TablePlugin.withComponent(TableElement),
	TableRowPlugin.withComponent(TableRowElement),
	TableCellPlugin.withComponent(TableCellElement),
	TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
	TrailingParagraphPlugin,

	// Drag and drop. The provider must wrap the Slate surface, which is what
	// `aboveSlate` does. The plugin is edit only, so the static viewer and
	// clients never see drag handles.
	DndPlugin.configure({
		render: {
			aboveNodes: BlockDraggable,
			aboveSlate: ({ children }) => (
				<DndProvider backend={HTML5Backend}>{children}</DndProvider>
			),
		},
	}),

	// Marks
	BoldPlugin.withComponent(BoldLeaf),
	ItalicPlugin.withComponent(ItalicLeaf),
	UnderlinePlugin.withComponent(UnderlineLeaf),
	StrikethroughPlugin.withComponent(StrikethroughLeaf),
	CodePlugin.withComponent(CodeLeaf),

	// Links. The autolink rules turn a pasted or typed URL into a link as soon
	// as the action completes, so the writer never has to open the link prompt
	// to confirm what the browser already treats as a URL.
	LinkPlugin.configure({
		inputRules: [
			LinkRules.markdown(),
			LinkRules.autolink({ variant: "paste" }),
			LinkRules.autolink({ variant: "space" }),
			LinkRules.autolink({ variant: "break" }),
		],
		options: { getUrlHref: autolinkHref },
	}).withComponent(LinkElement),
];

/**
 * The empty document.
 *
 * Slate requires at least one text node, so "no details yet" still has a real
 * paragraph to focus. The API stores an empty array for an empty body, and this
 * function is the only place that turns it back into something editable.
 */
export const EMPTY_EDITOR_VALUE = [{ type: "p", children: [{ text: "" }] }];

/**
 * Plugins for the read-only renderer.
 *
 * Drag and drop is edit only. `PlateStatic` still walks `render.aboveNodes`,
 * but its wrapper needs a Plate provider that the static path does not mount,
 * so the plugin is removed from this list instead of being conditionally
 * skipped at render time.
 */
export const milestoneStaticEditorPlugins = [
	...milestoneEditorPlugins.filter(
		(plugin) =>
			plugin.key !== "dnd" &&
			plugin.key !== KEYS.img &&
			plugin.key !== KEYS.caption,
	),
	// The static image node renders the stored width and caption directly.
	// It never mounts the resize handles or the preview dialog.
	BaseImagePlugin.withComponent(ImageElementStatic),
];
