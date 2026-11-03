/**
 * Rich text sanitising and plain text extraction.
 *
 * Why this exists: the milestone description arrives from the browser as a
 * Plate (Slate) JSON value. Storing it unchecked would let a crafted request
 * write arbitrary node shapes, unbounded payloads and `javascript:` links into
 * a column that every project member later renders.
 *
 * The rules are a small allowlist rather than a blocklist:
 *   - only known block types survive, anything else becomes a paragraph so no
 *     content is lost
 *   - only known marks survive
 *   - link URLs must be absolute http, https or mailto
 *   - node count, depth and payload size are capped
 *
 * The same walk produces `description_text`, the plain text mirror used by
 * search and previews. Keeping both in one pass means they can never disagree.
 *
 * Used by: src/services/milestone.service.ts.
 */

import { APIError } from "better-auth/api";
import {
	MILESTONE_DESCRIPTION_MAX,
	MILESTONE_TEXT_MAX,
} from "../auth/milestone-permissions";

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

/** Largest row or column span accepted. */
const MAX_TABLE_SPAN = 20;

/** Largest number of column widths stored on a table. */
const MAX_TABLE_COLUMNS = 20;

/** Widest single column accepted, in pixels. */
const MAX_TABLE_COLUMN_WIDTH = 2_000;

/** Link protocols that are safe to render as a clickable anchor. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Defensive caps. A real description is far below all three. */
const MAX_NODES = 10_000;
const MAX_DEPTH = 12;
const MAX_LEAF_LENGTH = 20_000;

/** Mutable state threaded through the walk. */
type SanitizeState = {
	nodes: number;
	text: string[];
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
): unknown | null {
	if (!isRecord(node)) return null;

	state.nodes += 1;

	if (state.nodes > MAX_NODES) {
		throw new APIError("BAD_REQUEST", {
			message: "The milestone details are too complex to save.",
		});
	}

	if (depth > MAX_DEPTH) {
		throw new APIError("BAD_REQUEST", {
			message: "The milestone details are nested too deeply to save.",
		});
	}

	// A leaf carries text plus optional marks. This is the only node kind that
	// contributes to the plain text mirror.
	if (typeof node.text === "string") {
		const text = node.text.slice(0, MAX_LEAF_LENGTH);
		state.text.push(text);

		const leaf: Record<string, unknown> = { text };

		for (const mark of ALLOWED_MARKS) {
			if (node[mark] === true) leaf[mark] = true;
		}

		return leaf;
	}

	const rawType = typeof node.type === "string" ? node.type : "p";
	// An unknown type is downgraded rather than dropped, so a plugin that is
	// added later and then removed cannot silently eat a document.
	const type = ALLOWED_BLOCK_TYPES.has(rawType) ? rawType : "p";

	const rawChildren = Array.isArray(node.children) ? node.children : [];
	const children: unknown[] = [];

	// Block boundaries become newlines, which is what makes the plain text
	// mirror readable when it is shown as a preview.
	state.text.push("\n");

	for (const child of rawChildren) {
		const clean = sanitizeNode(child, depth + 1, state);
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
	}

	// Indentation is a single bounded integer on supported block types. It
	// changes only spacing, so an arbitrary number written by a crafted request
	// is not allowed to survive the round trip.
	if (INDENTABLE_BLOCK_TYPES.has(type) && Number.isInteger(node.indent)) {
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
function normalizeText(parts: string[]): string {
	const joined = parts
		.join("")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	return joined.slice(0, MILESTONE_TEXT_MAX);
}

/**
 * Validate and clean a milestone description.
 *
 * Throws a BAD_REQUEST API error for a value that is not a Plate array or is
 * too large. Anything structurally odd inside the array is cleaned instead,
 * because a slightly unusual node should not stop somebody from saving.
 */
export function sanitizeRichText(value: unknown): SanitizedRichText {
	// Null and undefined mean "no details yet" and have one representation.
	if (value == null) return { value: [], text: "" };

	if (!Array.isArray(value)) {
		throw new APIError("BAD_REQUEST", {
			message: "The milestone details must be an editor document.",
		});
	}

	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new APIError("BAD_REQUEST", {
			message: "The milestone details could not be read.",
		});
	}

	if (serialized.length > MILESTONE_DESCRIPTION_MAX) {
		throw new APIError("BAD_REQUEST", {
			message: "The milestone details are too large to save.",
		});
	}

	const state: SanitizeState = { nodes: 0, text: [] };
	const clean: unknown[] = [];

	for (const node of value) {
		const sanitized = sanitizeNode(node, 0, state);
		if (sanitized !== null) clean.push(sanitized);
	}

	// An empty document is stored as an empty array, never as `[{"type":"p"}]`,
	// so "no details" has exactly one representation.
	if (clean.length === 0) return { value: [], text: "" };

	return { value: clean, text: normalizeText(state.text) };
}
