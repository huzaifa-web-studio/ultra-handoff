/**
 * The comment editor plugin set.
 *
 * Why it reuses the milestone kit instead of a second curated list: a comment
 * is now a full rich text message. It needs tables, images, link cards, bookmarks,
 * checklists, attachments and indentation, and every one of those already has a
 * renderer and a sanitizer rule in the milestone editor. Reusing the kit keeps
 * the two surfaces looking and behaving the same, including the link hover card
 * and the attachment card.
 *
 * The one thing removed is drag and drop. The product explicitly does not want
 * draggable sections inside a discussion, and removing `DndPlugin` also removes
 * the block gutter that hosts the side insert menu. Blocks are inserted from the
 * bottom toolbar instead.
 *
 * Mentions are the one thing added on top of the milestone kit: people in the
 * project, visible projects and their milestones. The mention trigger is handled
 * by the comment editor as ordinary text, so this kit only registers the stored
 * chip node. No Plate combobox input node is mounted, which is what keeps typing
 * inside the editor while the picker is open.
 *
 * Used by: comments/editor/comment-editor.tsx.
 */

import { ListItemPlugin } from "@platejs/list-classic/react";

import {
	milestoneEditorPlugins,
	milestoneStaticEditorPlugins,
} from "../../editor/editor-kit";
import { CommentStaticListItemElement } from "../comment-checklist";
import { CommentMentionPlugin } from "./mention-plugin";

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
export const commentEditorPlugins = [
	...commentBasePlugins,
	// Mentions are a comment feature. The milestone description kit does not
	// include them, and the sanitizer only accepts them in a comment body.
	CommentMentionPlugin,
];

/**
 * Everything the static milestone renderer has, except the list item renderer.
 *
 * The list item is swapped for one whose checklist checkbox stays interactive,
 * because toggling an item is a shared action that does not require editing the
 * comment.
 */
const commentStaticBasePlugins = milestoneStaticEditorPlugins.filter(
	(plugin) => plugin.key !== "li",
);

/** The plugins passed to the static renderer. */
export const commentStaticEditorPlugins = [
	...commentStaticBasePlugins,
	// The static mention renders the same chip, without any picker machinery.
	CommentMentionPlugin,
	ListItemPlugin.withComponent(CommentStaticListItemElement),
];
