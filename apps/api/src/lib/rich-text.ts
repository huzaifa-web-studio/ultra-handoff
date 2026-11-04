/**
 * Rich text sanitising and plain text extraction.
 *
 * Why this exists: rich text arrives from the browser as a Plate (Slate) JSON
 * value. Storing it unchecked would let a crafted request write arbitrary node
 * shapes, unbounded payloads and `javascript:` links into a column that every
 * project member later renders.
 *
 * The rules are a small allowlist rather than a blocklist:
 *   - only known block types survive, anything else becomes a paragraph so no
 *     content is lost
 *   - only known marks survive
 *   - link URLs must be absolute http, https or mailto
 *   - node count, depth and payload size are capped
 *
 * Two profiles share the walk. A milestone description is a short brief that
 * may contain headings, tables, images and bookmarks. A comment is a message
 * and only allows the lighter block set, with smaller caps. Keeping one walk
 * means the two can never develop different link or mark rules.
 *
 * The same walk produces the plain text mirror used by search, previews and
 * empty body checks. Keeping both in one pass means they can never disagree.
 *
 * Used by: src/services/milestone.service.ts and
 * src/services/comment.service.ts.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import {
	COMMENT_BODY_MAX,
	COMMENT_TEXT_MAX,
} from "../auth/comment-permissions";
import {
	MILESTONE_DESCRIPTION_MAX,
	MILESTONE_TEXT_MAX,
} from "../auth/milestone-permissions";
import { MAX_COMMENT_FILE_BYTES } from "./storage/config";

/** Block types the editor is allowed to produce. */
const ALLOWED_BLOCK_TYPES = new Set([
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
]);

/** Marks the editor toolbar can toggle. */
const ALLOWED_MARKS = new Set([
	"bold",
	"italic",
	"underline",
	"strikethrough",
	"code",
]);

/** Block types that may carry an indent level. */
const INDENTABLE_BLOCK_TYPES = new Set(["p", "h2", "h3", "blockquote"]);

/** Highest indent level accepted from a saved document. */
const MAX_INDENT = 8;

/** Cell types that can carry a row or column span. */
const TABLE_CELL_TYPES = new Set(["td", "th"]);

/** Longest image alt text stored. A short caption is enough for a screen reader. */
const MAX_IMAGE_ALT_LENGTH = 200;

/** Longest caption stored on an image. */
const MAX_IMAGE_CAPTION_LENGTH = 500;

/** Width range the resize handle can produce, in pixels. */
const MIN_IMAGE_WIDTH = 92;
const MAX_IMAGE_WIDTH = 4_096;

/** Largest row or column span accepted. */
const MAX_TABLE_SPAN = 20;

/** Largest number of column widths stored on a table. */
const MAX_TABLE_COLUMNS = 20;

/** Widest single column accepted, in pixels. */
const MAX_TABLE_COLUMN_WIDTH = 2_000;

/** Link protocols that are safe to render as a clickable anchor. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Block types a comment is allowed to contain.
 *
 * The comment composer is a full editor: headings, quotes, lists, checklists,
 * tables, images, link cards and file attachments. The set is explicit so a
 * plugin that exists only in the milestone kit still cannot be smuggled into a
 * comment, and `file` is the one type the milestone kit never produces.
 */
const COMMENT_BLOCK_TYPES = new Set([
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
]);

/** Longest attachment name stored on a file node. */
const MAX_FILE_NAME_LENGTH = 200;

/** Longest MIME string stored on a file node. Used only for the type icon. */
const MAX_FILE_MIME_LENGTH = 100;

/**
 * The rules for one kind of rich text value.
 *
 * Why a profile instead of more parameters: the walk needs the same six limits
 * and two allowlists everywhere, and passing them one by one makes every call
 * site long and easy to get wrong. A profile is the unit the two surfaces
 * differ by.
 */
type RichTextProfile = {
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

/** A milestone description: structure, tables, images and bookmarks. */
const MILESTONE_PROFILE: RichTextProfile = {
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
const COMMENT_PROFILE: RichTextProfile = {
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
type SanitizeState = {
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

/** True for a plain object, not an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keep a link URL only when it is absolute and uses a safe protocol.
 *
 * A relative URL is dropped rather than kept: the editor always writes
 * absolute links, so a relative one means the value did not come from the
 * editor.
 */
function safeUrl(url: unknown): string | undefined {
	if (typeof url !== "string") return undefined;

	const trimmed = url.trim();
	if (trimmed.length === 0) return undefined;

	try {
		return ALLOWED_PROTOCOLS.has(new URL(trimmed).protocol)
			? trimmed
			: undefined;
	} catch {
		return undefined;
	}
}

/**
 * Keep an image source or attachment URL only when it is safe to render.
 *
 * Uploaded objects are served from our own origin through `/files/...`, which
 * the editor stores as a relative URL, so that form is allowed alongside an
 * absolute http or https URL. Anything else, including `data:`, `blob:` and
 * protocol relative values, is dropped.
 */
function safeAssetUrl(url: unknown): string | undefined {
	if (typeof url !== "string") return undefined;

	const trimmed = url.trim();
	if (trimmed.length === 0) return undefined;

	// Uploaded objects are the only relative form the editor produces. Reject
	// traversal, whitespace and a protocol relative value up front.
	if (trimmed.startsWith("/files/")) {
		if (
			trimmed.includes("..") ||
			trimmed.includes("\\") ||
			/\s/.test(trimmed)
		) {
			return undefined;
		}

		return trimmed;
	}

	try {
		const protocol = new URL(trimmed).protocol;

		return protocol === "http:" || protocol === "https:" ? trimmed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Read a span from a number or a pasted HTML attribute.
 *
 * A span of one is the default and is not stored. Anything outside the allowed
 * range is capped instead of rejected, so a slightly odd table still saves.
 */
function readSpan(value: unknown): number | undefined {
	const numeric = typeof value === "string" ? Number(value) : value;

	if (
		typeof numeric !== "number" ||
		!Number.isInteger(numeric) ||
		numeric < 2
	) {
		return undefined;
	}

	return Math.min(numeric, MAX_TABLE_SPAN);
}

/**
 * Sanitise one node and append its text to the mirror.
 *
 * Returns null for a value that cannot be represented at all (a string, a
 * number, an empty object), so the caller can drop it instead of writing
 * something the editor cannot render.
 */
function sanitizeNode(
	node: unknown,
	depth: number,
	state: SanitizeState,
	profile: RichTextProfile,
): unknown | null {
	if (!isRecord(node)) return null;

	state.nodes += 1;

	if (state.nodes > profile.maxNodes) {
		throw new APIError("BAD_REQUEST", {
			message: `The ${profile.label} is too complex to save.`,
		});
	}

	if (depth > profile.maxDepth) {
		throw new APIError("BAD_REQUEST", {
			message: `The ${profile.label} is nested too deeply to save.`,
		});
	}

	// A leaf carries text plus optional marks. This is the only node kind that
	// contributes to the plain text mirror.
	if (typeof node.text === "string") {
		const text = node.text.slice(0, profile.maxLeafLength);
		state.text.push(text);

		const leaf: Record<string, unknown> = { text };

		for (const mark of profile.allowedMarks) {
			if (node[mark] === true) leaf[mark] = true;
		}

		return leaf;
	}

	const rawType = typeof node.type === "string" ? node.type : "p";

	// A void block this profile does not allow has no text to keep, so it is
	// dropped instead of becoming an empty paragraph. This is what stops a
	// crafted request from putting an image or a bookmark into a comment.
	if (
		!profile.allowedBlocks.has(rawType) &&
		(rawType === "img" || rawType === "bookmark" || rawType === "file")
	) {
		return null;
	}

	// An unknown type is downgraded rather than dropped, so a plugin that is
	// added later and then removed cannot silently eat a document.
	const type = profile.allowedBlocks.has(rawType) ? rawType : "p";

	// A bookmark is a void block that only carries a URL. The preview itself is
	// looked up by that URL, so no metadata is stored in the document and a
	// stale card can never be written into the body.
	if (type === "bookmark") {
		const url = safeUrl(node.url);
		if (!url) return null;

		// Keep a line break in the mirror so a preview does not run the text on
		// either side of the card together.
		state.text.push("\n");

		return {
			type: "bookmark",
			url,
			// Plate requires every element to have a child, even when it renders
			// as void.
			children: [{ text: "" }],
		};
	}

	// A file attachment is a void block carrying the metadata its card renders.
	// The bytes live in object storage; only the reference is stored here.
	if (type === "file") {
		const url = safeAssetUrl(node.url);
		if (!url) return null;

		const rawName = typeof node.name === "string" ? node.name.trim() : "";
		const name = rawName.slice(0, MAX_FILE_NAME_LENGTH) || "Attachment";
		const mime =
			typeof node.mime === "string"
				? node.mime.trim().slice(0, MAX_FILE_MIME_LENGTH)
				: "";
		const size =
			typeof node.size === "number" &&
			Number.isInteger(node.size) &&
			node.size >= 0 &&
			node.size <= MAX_COMMENT_FILE_BYTES
				? node.size
				: undefined;

		const file: Record<string, unknown> = {
			type: "file",
			url,
			name,
			// Plate requires every element to have a child, even when it renders
			// as void. The renderer keeps it invisible.
			children: [{ text: "" }],
		};

		if (mime.length > 0) file.mime = mime;
		if (size !== undefined) file.size = size;

		// Keep the attachment name searchable through the plain text mirror.
		state.text.push(`\n${name}\n`);

		return file;
	}

	// An image is a void block with no text. It is kept only when its source
	// is safe to render; an image that cannot load is dropped rather than
	// turned into an empty paragraph the writer never wrote.
	if (type === "img") {
		const url = safeAssetUrl(node.url);
		if (!url) return null;

		const image: Record<string, unknown> = {
			type: "img",
			url,
			// Plate requires every element to have a child, even when the node
			// renders as void. The renderer keeps it invisible.
			children: [{ text: "" }],
		};

		const attributes = isRecord(node.attributes) ? node.attributes : null;
		const rawAlt =
			typeof node.alt === "string"
				? node.alt
				: typeof attributes?.alt === "string"
					? attributes.alt
					: "";

		if (rawAlt.trim().length > 0) {
			image.alt = rawAlt.trim().slice(0, MAX_IMAGE_ALT_LENGTH);
		}

		// A resized image keeps a single pixel width. The value is bounded so a
		// crafted request cannot make one image cover an arbitrary grid.
		if (
			typeof node.width === "number" &&
			Number.isInteger(node.width) &&
			node.width >= MIN_IMAGE_WIDTH &&
			node.width <= MAX_IMAGE_WIDTH
		) {
			image.width = node.width;
		}

		// Captions are stored as a plain text array on the image node, which is
		// the shape the caption plugin reads and the static renderer displays.
		if (Array.isArray(node.caption)) {
			const caption = node.caption
				.filter(isRecord)
				.map((leaf) => (typeof leaf.text === "string" ? leaf.text : ""))
				.join("")
				.trim()
				.slice(0, MAX_IMAGE_CAPTION_LENGTH);

			if (caption.length > 0) {
				image.caption = [{ text: caption }];
				// Keep the caption searchable through the plain text mirror.
				state.text.push(caption);
			}
		}

		// Keep a line break in the plain text mirror so a preview does not run
		// the text on either side of the image together.
		state.text.push("\n");

		return image;
	}

	const rawChildren = Array.isArray(node.children) ? node.children : [];
	const children: unknown[] = [];

	// Block boundaries become newlines, which is what makes the plain text
	// mirror readable when it is shown as a preview.
	state.text.push("\n");

	for (const child of rawChildren) {
		const clean = sanitizeNode(child, depth + 1, state, profile);
		if (clean !== null) children.push(clean);
	}

	// A Plate element must have at least one child, otherwise the editor
	// crashes when it tries to render it.
	if (children.length === 0) children.push({ text: "" });

	const element: Record<string, unknown> = { type, children };

	// A checklist item stores its state on the list item itself. It is the only
	// boolean the editor may write, so it is kept explicitly rather than by
	// copying arbitrary node props.
	if (type === "li" && typeof node.checked === "boolean") {
		element.checked = node.checked;

		// A checklist item needs a stable id so any reader can toggle it with a
		// targeted request instead of editing the whole comment. A valid id from
		// the editor is preserved; a missing or duplicate one is replaced.
		const rawId = typeof node.id === "string" ? node.id.trim() : "";
		const id =
			/^[A-Za-z0-9_-]{1,64}$/.test(rawId) && !state.itemIds.has(rawId)
				? rawId
				: randomUUID();

		state.itemIds.add(id);
		element.id = id;
	}

	// Indentation is a single bounded integer on supported block types. It
	// changes only spacing, so an arbitrary number written by a crafted request
	// is not allowed to survive the round trip.
	if (profile.indentableBlocks.has(type) && Number.isInteger(node.indent)) {
		const indent = node.indent as number;
		if (indent >= 1 && indent <= MAX_INDENT) element.indent = indent;
	}

	// A merged table cell keeps its span. The value is bounded so a crafted
	// request cannot make one cell cover a huge grid. Pasted HTML carries the
	// span in `attributes`, while the editor stores it on the node.
	if (TABLE_CELL_TYPES.has(type)) {
		const attributes = isRecord(node.attributes) ? node.attributes : null;
		const colSpan = readSpan(node.colSpan) ?? readSpan(attributes?.colspan);
		const rowSpan = readSpan(node.rowSpan) ?? readSpan(attributes?.rowspan);

		if (colSpan) element.colSpan = colSpan;
		if (rowSpan) element.rowSpan = rowSpan;
	}

	// Column widths are optional and only affect layout. Keep a small, finite
	// list so a resized table reloads with the same proportions.
	if (type === "table" && Array.isArray(node.colSizes)) {
		const colSizes = node.colSizes
			.filter(
				(size): size is number =>
					typeof size === "number" &&
					Number.isFinite(size) &&
					size > 0 &&
					size <= MAX_TABLE_COLUMN_WIDTH,
			)
			.slice(0, MAX_TABLE_COLUMNS);

		if (colSizes.length > 0) element.colSizes = colSizes;
	}

	if (type === "a" || rawType === "a") {
		const url = safeUrl(node.url);
		if (url) {
			element.type = "a";
			element.url = url;
		}
	}

	state.text.push("\n");

	return element;
}

/** Collapse runs of blank lines and trim the ends of the mirror. */
function normalizeText(parts: string[], maxText: number): string {
	const joined = parts
		.join("")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return joined.slice(0, maxText);
}

/**
 * Validate and clean one rich text value against a profile.
 *
 * Throws a BAD_REQUEST API error for a value that is not a Plate array or is
 * too large. Anything structurally odd inside the array is cleaned instead,
 * because a slightly unusual node should not stop somebody from saving.
 */
function sanitizeProfile(
	value: unknown,
	profile: RichTextProfile,
): SanitizedRichText {
	// Null and undefined mean "nothing written yet" and have one representation.
	if (value == null) return { value: [], text: "" };

	if (!Array.isArray(value)) {
		throw new APIError("BAD_REQUEST", {
			message: `The ${profile.label} must be an editor document.`,
		});
	}

	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new APIError("BAD_REQUEST", {
			message: `The ${profile.label} could not be read.`,
		});
	}

	if (serialized.length > profile.maxJson) {
		throw new APIError("BAD_REQUEST", {
			message: `The ${profile.label} is too large to save.`,
		});
	}

	const state: SanitizeState = {
		nodes: 0,
		text: [],
		itemIds: new Set(),
	};
	const clean: unknown[] = [];

	for (const node of value) {
		const sanitized = sanitizeNode(node, 0, state, profile);
		if (sanitized !== null) clean.push(sanitized);
	}

	// An empty document is stored as an empty array, never as `[{"type":"p"}]`,
	// so "nothing written" has exactly one representation.
	if (clean.length === 0) return { value: [], text: "" };

	return { value: clean, text: normalizeText(state.text, profile.maxText) };
}

/**
 * Validate and clean a milestone description.
 *
 * Kept as the default entry point so every existing milestone caller keeps its
 * exact behaviour while the shared walk gains profiles.
 */
export function sanitizeRichText(value: unknown): SanitizedRichText {
	return sanitizeProfile(value, MILESTONE_PROFILE);
}

/**
 * Block types that count as content even with no text of their own.
 *
 * An image, an attachment and a bookmark card are complete messages. A table or
 * an empty list is structural, so it still needs a word to be worth sending.
 */
const COMMENT_EMBED_TYPES = new Set(["img", "file", "bookmark"]);

/**
 * True when a cleaned comment has text or a self-contained embed.
 *
 * Why not only the text mirror: an image with no caption and a file card have no
 * text leaf, but they are exactly the cases a reader expects to be able to post.
 */
function hasCommentContent(value: unknown[]): boolean {
	let found = false;

	const walk = (node: unknown): void => {
		if (found || !isRecord(node)) return;

		if (typeof node.text === "string" && node.text.trim().length > 0) {
			found = true;
			return;
		}

		if (typeof node.type === "string" && COMMENT_EMBED_TYPES.has(node.type)) {
			found = true;
			return;
		}

		if (Array.isArray(node.children)) {
			for (const child of node.children) walk(child);
		}
	};

	for (const node of value) walk(node);

	return found;
}

/**
 * Validate and clean a comment body.
 *
 * The content check is here and not only in the service because the sanitizer
 * has already removed anything the editor cannot render. A comment is valid when
 * it has text or a self-contained embed, so an image or a file with no caption
 * can still be posted.
 */
export function sanitizeCommentBody(value: unknown): SanitizedRichText {
	const sanitized = sanitizeProfile(value, COMMENT_PROFILE);

	if (!hasCommentContent(sanitized.value)) {
		throw new APIError("BAD_REQUEST", {
			message: "Write something before posting your comment.",
		});
	}

	return sanitized;
}
