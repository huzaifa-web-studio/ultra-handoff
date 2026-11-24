/**
 * Rich text allowlists and profile limits.
 *
 * Why this file: the node, mark, table and protocol allowlists and the two
 * profile caps are the data the sanitizer walks against. Keeping them in one
 * place means the milestone and comment profiles cannot drift.
 *
 * Used by: the modules in `lib/rich-text/`.
 */

import {
	COMMENT_BODY_MAX,
	COMMENT_TEXT_MAX,
} from "../../auth/comment-permissions";
import {
	MILESTONE_DESCRIPTION_MAX,
	MILESTONE_TEXT_MAX,
} from "../../auth/milestone-permissions";

/** Block types the editor is allowed to produce. */
export const ALLOWED_BLOCK_TYPES = new Set([
	"p",
	"h1",
	"h2",
	"h3",
	"h4",
	"blockquote",
	"ul",
	"ol",
	"li",
	"lic",
	"taskList",
	"table",
	"tr",
	"td",
	"th",
	"code_block",
	"code_line",
	"hr",
	"img",
	"bookmark",
	"file",
	"mention",
]);

/** Marks the editor toolbar can toggle. */
export const ALLOWED_MARKS = new Set([
	"bold",
	"italic",
	"underline",
	"strikethrough",
	"code",
]);

/** Block types that may carry an indent level. */
export const INDENTABLE_BLOCK_TYPES = new Set(["p", "h2", "h3", "blockquote"]);

/** Highest indent level accepted from a saved document. */
export const MAX_INDENT = 8;

/** Cell types that can carry a row or column span. */
export const TABLE_CELL_TYPES = new Set(["td", "th"]);

/** Longest image alt text stored. A short caption is enough for a screen reader. */
export const MAX_IMAGE_ALT_LENGTH = 200;

/** Longest caption stored on an image. */
export const MAX_IMAGE_CAPTION_LENGTH = 500;

/** Width range the resize handle can produce, in pixels. */
export const MIN_IMAGE_WIDTH = 92;
export const MAX_IMAGE_WIDTH = 4_096;

/** Largest row or column span accepted. */
export const MAX_TABLE_SPAN = 20;

/** Largest number of column widths stored on a table. */
export const MAX_TABLE_COLUMNS = 20;

/** Widest single column accepted, in pixels. */
export const MAX_TABLE_COLUMN_WIDTH = 2_000;

/** Link protocols that are safe to render as a clickable anchor. */
export const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Block types a comment is allowed to contain.
 *
 * The comment composer is a full editor: headings, quotes, lists, checklists,
 * tables, images, link cards and file attachments. The set is explicit so a
 * plugin that exists only in the milestone kit still cannot be smuggled into a
 * comment.
 */
export const COMMENT_BLOCK_TYPES = new Set([
	"p",
	"h2",
	"h3",
	"blockquote",
	"ul",
	"ol",
	"li",
	"lic",
	"taskList",
	"table",
	"tr",
	"td",
	"th",
	"img",
	"bookmark",
	"file",
	"mention",
]);

/** Longest attachment name stored on a file node. */
export const MAX_FILE_NAME_LENGTH = 200;

/** Longest MIME string stored on a file node. Used only for the type icon. */
export const MAX_FILE_MIME_LENGTH = 100;

/**
 * The rules for one kind of rich text value.
 *
 * Why a profile instead of more parameters: the walk needs the same six limits
 * and two allowlists everywhere, and passing them one by one makes every call
 * site long and easy to get wrong. A profile is the unit the two surfaces
 * differ by.
 */
export type RichTextProfile = {
	/** Human label used in error messages, for example "comment". */
	label: string;
	allowedBlocks: ReadonlySet<string>;
	allowedMarks: ReadonlySet<string>;
	indentableBlocks: ReadonlySet<string>;
	maxNodes: number;
	maxDepth: number;
	maxLeafLength: number;
	maxJson: number;
	maxText: number;
};

/** A milestone description: structure, tables, images, attachments and bookmarks. */
export const MILESTONE_PROFILE: RichTextProfile = {
	label: "milestone description",
	allowedBlocks: ALLOWED_BLOCK_TYPES,
	allowedMarks: ALLOWED_MARKS,
	indentableBlocks: INDENTABLE_BLOCK_TYPES,
	// A real description is far below all three.
	maxNodes: 10_000,
	maxDepth: 12,
	maxLeafLength: 20_000,
	maxJson: MILESTONE_DESCRIPTION_MAX,
	maxText: MILESTONE_TEXT_MAX,
};

/**
 * A comment: paragraphs, quotes, lists and marks.
 *
 * No headings, tables, images or bookmarks. A comment is a message, so the
 * smaller caps are deliberate rather than an oversight.
 */
export const COMMENT_PROFILE: RichTextProfile = {
	label: "comment",
	allowedBlocks: COMMENT_BLOCK_TYPES,
	allowedMarks: ALLOWED_MARKS,
	indentableBlocks: INDENTABLE_BLOCK_TYPES,
	maxNodes: 3_000,
	maxDepth: 10,
	maxLeafLength: 5_000,
	maxJson: COMMENT_BODY_MAX,
	maxText: COMMENT_TEXT_MAX,
};

/** Mutable state threaded through the walk. */
export type SanitizeState = {
	nodes: number;
	text: string[];
	/**
	 * Checklist ids already used in this document.
	 *
	 * A checklist item needs a stable id so any reader can toggle it without
	 * editing the comment. The set keeps a crafted duplicate from making two
	 * items share one id.
	 */
	itemIds: Set<string>;
};

/** The sanitised value plus its plain text mirror. */
export type SanitizedRichText = {
	value: unknown[];
	text: string;
};
