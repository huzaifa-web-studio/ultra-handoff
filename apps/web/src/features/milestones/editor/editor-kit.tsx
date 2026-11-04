"use client";

/**
 * The milestone editor plugin set.
 *
 * Why curated instead of a full kit: a milestone description is a short brief,
 * not a document. Every plugin adds bundle weight and another node type the
 * server sanitizer has to understand. This list is the smallest set that covers
 * writing a usable brief: structure, emphasis, lists, links, images and
 * attachments.
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
import { ElementApi, KEYS, PathApi } from "platejs";
import { createPlatePlugin, ParagraphPlugin } from "platejs/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { autolinkHref } from "./editor-autolink";
import {
	BlockSidePlugin,
	clearBlockSide,
	isBlockSideFor,
} from "./editor-block-side";
import { BookmarkElementStatic, BookmarkPlugin } from "./editor-bookmark";
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
	LinkElementStatic,
	ListItemContentElement,
	ListItemElement,
	NumberedListElement,
	ParagraphElement,
	StrikethroughLeaf,
	TaskListElement,
	UnderlineLeaf,
} from "./editor-elements";
import { FileElement, FileElementStatic, FilePlugin } from "./editor-file";
import { ImageElement, ImageElementStatic } from "./editor-image";
import { EditorFloatingLinkToolbar } from "./editor-link-toolbar";
import { MediaPreviewDialog } from "./editor-media-preview";
import {
	TableCellElement,
	TableCellHeaderElement,
	TableElement,
	TableRowElement,
} from "./editor-table";

/**
 * Keeps an empty paragraph after a block that ends the document.
 *
 * Why: a void block at the end has nowhere for the caret. Clicking the empty
 * space below a table, an image or a bookmark cannot focus an editor that has
 * nothing there, so the writer gets stuck and has to use the arrow keys.
 *
 * Tables were the original case. Images and bookmarks have the same shape, and
 * a bookmark moved to the end by drag or by deleting the paragraph below it
 * reproduced the same dead end, so all three are covered.
 *
 * The paragraph is only inserted when there is no node below, so real content
 * is never replaced.
 */
const TRAILING_PARAGRAPH_TYPES = new Set(["table", "img", "bookmark", "file"]);

const TrailingParagraphPlugin = createPlatePlugin({
	key: "milestoneTrailingParagraph",
}).overrideEditor(({ editor, tf: { normalizeNode, insertBreak } }) => ({
	transforms: {
		normalizeNode(entry, options) {
			const [node, path] = entry;

			if (
				path.length === 1 &&
				ElementApi.isElement(node) &&
				typeof node.type === "string" &&
				TRAILING_PARAGRAPH_TYPES.has(node.type)
			) {
				const nextPath = PathApi.next(path);
				const nextNode = editor.api.node(nextPath)?.[0];

				const nextIsSpecial =
					nextNode !== undefined &&
					ElementApi.isElement(nextNode) &&
					typeof nextNode.type === "string" &&
					TRAILING_PARAGRAPH_TYPES.has(nextNode.type);

				// A line is needed when the block ends the document or when the
				// next block is another atomic one. Two void blocks side by side
				// otherwise have no interior where the caret can live, so there
				// is no way to click between them or press Enter to add a gap.
				if (!nextNode || nextIsSpecial) {
					editor.tf.insertNodes(
						{ type: "p", children: [{ text: "" }] },
						{ at: nextPath },
					);
					return;
				}
			}

			normalizeNode(entry, options);
		},

		/**
		 * Enter on a table, image or bookmark creates a line on the chosen side.
		 *
		 * A side pressed on a block edge wins. Otherwise a void block defaults
		 * to a line below it, which is the behaviour most writers expect when
		 * they select an image and press Enter. A table without a chosen side
		 * falls through, because Enter inside a table cell must keep editing
		 * that cell.
		 */
		insertBreak() {
			if (!editor.selection) {
				insertBreak();
				return;
			}

			const blockEntry = editor.api.above({
				at: editor.selection,
				match: (node) =>
					ElementApi.isElement(node) &&
					(editor.api.isVoid(node) || node.type === editor.getType("table")),
			});

			if (!blockEntry) {
				clearBlockSide(editor);
				insertBreak();
				return;
			}

			const [blockNode, blockPath] = blockEntry;
			const storedSide = editor.getOption(BlockSidePlugin, "side");
			const selectedSide = isBlockSideFor(editor, blockPath)
				? storedSide
				: ElementApi.isElement(blockNode) && editor.api.isVoid(blockNode)
					? "after"
					: null;

			clearBlockSide(editor);

			if (!selectedSide) {
				insertBreak();
				return;
			}

			const siblingPath =
				selectedSide === "before"
					? PathApi.previous(blockPath)
					: PathApi.next(blockPath);
			const sibling = siblingPath
				? editor.api.node(siblingPath)?.[0]
				: undefined;

			// An empty paragraph is already on the requested side: move into it
			// instead of stacking a second blank line.
			if (
				siblingPath &&
				sibling &&
				ElementApi.isElement(sibling) &&
				sibling.type === editor.getType("p") &&
				editor.api.isEmpty(sibling)
			) {
				const point =
					selectedSide === "before"
						? editor.api.end(siblingPath)
						: editor.api.start(siblingPath);

				if (point) editor.tf.select(point);
				editor.tf.focus();
				return;
			}

			const at =
				selectedSide === "before" ? blockPath : PathApi.next(blockPath);

			editor.tf.insertNodes({ type: "p", children: [{ text: "" }] }, { at });

			const point = editor.api.start(at);
			if (point) editor.tf.select(point);
			editor.tf.focus();
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
	// Attachments. A void block that renders the stored file metadata, so a
	// brief or a deck can be handed over inside the description itself.
	FilePlugin.withComponent(FileElement),
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
	BlockSidePlugin,
	TrailingParagraphPlugin,

	// Bookmarks. A void block that renders the cached preview of one URL.
	// The URL is the only stored value, so the card can never go stale.
	BookmarkPlugin,

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
	//
	// `keepSelectedTextOnPaste` makes a URL pasted over selected text link that
	// text instead of replacing it, which is the behaviour every modern editor
	// has. The floating toolbar is registered as `afterEditable` so Cmd/Ctrl+K
	// works without an extra listener.
	LinkPlugin.configure({
		inputRules: [
			LinkRules.markdown(),
			LinkRules.autolink({ variant: "paste" }),
			LinkRules.autolink({ variant: "space" }),
			LinkRules.autolink({ variant: "break" }),
		],
		options: {
			getUrlHref: autolinkHref,
			keepSelectedTextOnPaste: true,
			defaultLinkAttributes: {
				target: "_blank",
				rel: "noopener noreferrer",
			},
		},
		render: {
			afterEditable: EditorFloatingLinkToolbar,
		},
	}).withComponent(LinkElement),
];

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
			plugin.key !== KEYS.caption &&
			plugin.key !== KEYS.link &&
			plugin.key !== "bookmark" &&
			plugin.key !== "file",
	),
	// The static image node renders the stored width and caption directly.
	// It never mounts the resize handles or the preview dialog.
	BaseImagePlugin.withComponent(ImageElementStatic),
	// The static link keeps the hover card but never intercepts a click.
	LinkPlugin.withComponent(LinkElementStatic),
	// The static bookmark keeps the card and opens the link on click.
	BookmarkPlugin.withComponent(BookmarkElementStatic),
	// The static attachment keeps the card and the download link, without the
	// remove control or the block edge handling.
	FilePlugin.withComponent(FileElementStatic),
];
