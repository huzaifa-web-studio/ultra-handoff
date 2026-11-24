/**
 * Rich text sanitizer walk.
 *
 * Why this file: the recursive walk is the one place that enforces the
 * allowlist, the depth and node caps and the plain text mirror. Keeping the walk
 * whole means the two profiles share the same rules.
 *
 * Used by: `sanitizeRichText` callers and `comment.ts`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import {
	MAX_MENTION_NAME,
	MENTION_SLUG_MAX,
	MENTION_SLUG_PATTERN,
	mentionKey,
	parseMentionKey,
} from "../mentions";
import { MAX_ATTACHMENT_BYTES } from "../storage/config";
import type {
	RichTextProfile,
	SanitizedRichText,
	SanitizeState,
} from "./constants";
import {
	MAX_FILE_MIME_LENGTH,
	MAX_FILE_NAME_LENGTH,
	MAX_IMAGE_ALT_LENGTH,
	MAX_IMAGE_CAPTION_LENGTH,
	MAX_IMAGE_WIDTH,
	MAX_INDENT,
	MAX_TABLE_COLUMN_WIDTH,
	MAX_TABLE_COLUMNS,
	MILESTONE_PROFILE,
	MIN_IMAGE_WIDTH,
	TABLE_CELL_TYPES,
} from "./constants";
import {
	isRecord,
	readSpan,
	safeAssetUrl,
	safeImageUrl,
	safeUrl,
} from "./urls";

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
	// crafted request from putting an image, an attachment, a bookmark or a
	// mention into a surface that does not offer it.
	if (
		!profile.allowedBlocks.has(rawType) &&
		(rawType === "img" ||
			rawType === "bookmark" ||
			rawType === "file" ||
			rawType === "mention")
	) {
		return null;
	}

	// An unknown type is downgraded rather than dropped, so a plugin that is
	// added later and then removed cannot silently eat a document.
	const type = profile.allowedBlocks.has(rawType) ? rawType : "p";

	/**
	 * A mention is an inline void node carrying a target and its display name.
	 *
	 * The key is canonicalised and the name bounded, so the stored node is
	 * always a shape the renderer understands. Access is checked later by the
	 * service, because the sanitizer has no database.
	 */
	if (type === "mention") {
		const parsed = parseMentionKey(node.key);
		if (!parsed) return null;

		const rawValue = typeof node.value === "string" ? node.value.trim() : "";
		if (rawValue.length === 0) return null;

		const value = rawValue.slice(0, MAX_MENTION_NAME);
		const mention: Record<string, unknown> = {
			type: "mention",
			key: mentionKey(parsed.type, parsed.id),
			value,
			// Plate requires every element to have a child, even when it renders
			// as void. The renderer keeps it invisible.
			children: [{ text: "" }],
		};

		// A project or milestone chip links through a project slug. Storing it
		// on the node means a reader needs no extra lookup to build the URL.
		if (parsed.type !== "user") {
			const rawSlug = typeof node.slug === "string" ? node.slug.trim() : "";

			if (
				rawSlug.length <= MENTION_SLUG_MAX &&
				MENTION_SLUG_PATTERN.test(rawSlug)
			) {
				mention.slug = rawSlug;
			}
		}

		// Keep the mention readable in the plain text copy used by previews and
		// search. People read as `@Name`, projects and milestones as `#Name`.
		state.text.push(`${parsed.type === "user" ? "@" : "#"}${value}`);

		return mention;
	}

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

	// A file attachment is a void node carrying the metadata its chip renders.
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
			node.size <= MAX_ATTACHMENT_BYTES
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
	// is one of our own uploads; an external image would phone home to the
	// third party every time the document renders.
	if (type === "img") {
		const url = safeImageUrl(node.url);
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
export function sanitizeProfile(
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
