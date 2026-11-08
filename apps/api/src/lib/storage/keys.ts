/**
 * Object key helpers for rich text and downloads.
 *
 * Why this file exists: rich text stores attachments as `/files/<key>` URLs
 * inside Plate JSON. Nothing links those keys to the row that owns them, so a
 * delete has to walk the stored document to find them before the row goes away.
 * The same walk is reused by the reconciliation script, which means cleanup on
 * write and cleanup after the fact cannot disagree about what a reference is.
 *
 * Used by: comment.service.ts, milestone.service.ts, project.service.ts,
 * routes/files.ts and scripts/reconcile-orphan-objects.ts.
 */

import { keyFromFileUrl } from "./client";

/** Largest number of keys one document may contribute. */
const MAX_KEYS = 500;

/**
 * A key is only usable when it is a clean `/files/...` reference.
 *
 * Traversal is rejected here rather than in each caller. The route applies the
 * same shape check, so a stored value that somehow contains `..` can never
 * reach object storage.
 */
function normaliseKey(url: string): string | null {
	// Strip a query string or fragment before reading the key. The viewer adds
	// `?download=1` in the browser, but a stored value may already carry one.
	const path = url.split(/[?#]/, 1)[0] ?? "";

	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		// Malformed percent encoding is not a real reference.
		return null;
	}

	const key = keyFromFileUrl(decoded);
	if (!key) return null;
	if (key.includes("..") || key.includes("//") || key.includes("\\")) {
		return null;
	}
	if (key.startsWith("/") || key.length === 0) return null;

	return key;
}

/** Recursively collect every `/files/` reference from an arbitrary value. */
export function keyFromRichText(
	value: unknown,
	collected: Set<string> = new Set(),
): string[] {
	if (collected.size >= MAX_KEYS) return [...collected];

	if (typeof value === "string") {
		if (value.includes("/files/")) {
			const key = normaliseKey(value);
			if (key) collected.add(key);
		}
		return [...collected];
	}

	if (Array.isArray(value)) {
		for (const item of value) keyFromRichText(item, collected);
		return [...collected];
	}

	if (value && typeof value === "object") {
		for (const item of Object.values(value)) {
			keyFromRichText(item, collected);
		}
	}

	return [...collected];
}

/**
 * Sanitise a download file name from a query parameter.
 *
 * The name is echoed into `Content-Disposition`, so quotes, backslashes, CR/LF
 * and path separators are removed before anything else. Control characters are
 * stripped as well, which also covers the header injection cases the CR/LF
 * check would catch.
 */
export function safeDownloadName(
	raw: string | null | undefined,
): string | null {
	if (typeof raw !== "string") return null;

	const cleaned = [...raw]
		// Control characters, including CR and LF, plus DEL. A file name has no
		// use for them, and CR/LF in the header would be an injection.
		.filter((character) => {
			const code = character.codePointAt(0) ?? 0;

			return code >= 0x20 && code !== 0x7f;
		})
		.join("")
		// Quotes would close the quoted string in the header.
		.replace(/["\\]/g, "")
		// A name is never a path.
		.replace(/[/\\]/g, "")
		.trim()
		.slice(0, 120);

	return cleaned.length > 0 ? cleaned : null;
}
