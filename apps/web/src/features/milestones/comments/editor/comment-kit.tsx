/**
 * The comment editor plugin set.
 *
 * Why it reuses the milestone kit instead of a second curated list: a comment
 * is now a full rich text message. It needs tables, images, link cards, bookmarks,
 * checklists and indentation, and every one of those already has a renderer and
 * a sanitizer rule in the milestone editor. Reusing the kit keeps the two
 * surfaces looking and behaving the same, including the link hover card.
 *
 * The one thing removed is drag and drop. The product explicitly does not want
 * draggable sections inside a discussion, and removing `DndPlugin` also removes
 * the block gutter that hosts the side insert menu. Blocks are inserted from the
 * bottom toolbar instead.
 *
 * The one thing added is the attachment node, which the milestone kit does not
 * have.
 *
 * Used by: comments/editor/comment-editor.tsx.
 */

import {
	milestoneEditorPlugins,
	milestoneStaticEditorPlugins,
} from "../../editor/editor-kit";
import { FileElementStatic, FilePlugin } from "./comment-file";

/**
 * Everything the milestone editor has except the drag provider.
 *
 * The gutter is rendered by the same plugin, so filtering it is what guarantees
 * no plus icon and no drag handle appear in a comment.
 */
const commentBasePlugins = milestoneEditorPlugins.filter(
	(plugin) => plugin.key !== "dnd",
);

/** The plugins passed to `usePlateEditor` while writing. */
export const commentEditorPlugins = [...commentBasePlugins, FilePlugin];

/** The plugins passed to the static renderer. */
export const commentStaticEditorPlugins = [
	...milestoneStaticEditorPlugins,
	FilePlugin.withComponent(FileElementStatic),
];
