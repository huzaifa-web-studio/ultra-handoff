/**
 * Rich text URL and value guards.
 *
 * Why this file: every link, image and attachment runs through the same
 * protocol, length and size checks. One helper set means a new node type cannot
 * invent a weaker rule.
 *
 * Used by: `core.ts` and `comment.ts`.
 */

/** True for a plain object, not an array or null. */

import { ALLOWED_PROTOCOLS, MAX_TABLE_SPAN } from "./constants";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keep a link URL only when it is absolute and uses a safe protocol.
 *
 * A relative URL is dropped rather than kept: the editor always writes
 * absolute links, so a relative one means the value did not come from the
 * editor.
 */
export function safeUrl(url: unknown): string | undefined {
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
 * Keep an image source only when it is one of our own uploads.
 *
 * Why stricter than `safeAssetUrl`: an external image is fetched by every
 * reader's browser, which turns a pasted URL into a tracking pixel. Images are
 * always uploaded through the editor, so a stored image is always a relative
 * `/files/...` path. Anything else is dropped.
 */
export function safeImageUrl(url: unknown): string | undefined {
	const value = safeAssetUrl(url);

	return value?.startsWith("/files/") ? value : undefined;
}

/**
 * Keep an image source or attachment URL only when it is safe to render.
 *
 * Uploaded objects are served from our own origin through `/files/...`, which
 * the editor stores as a relative URL, so that form is allowed alongside an
 * absolute http or https URL. Anything else, including `data:`, `blob:` and
 * protocol relative values, is dropped.
 */
export function safeAssetUrl(url: unknown): string | undefined {
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
export function readSpan(value: unknown): number | undefined {
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
