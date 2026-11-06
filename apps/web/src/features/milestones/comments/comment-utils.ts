/**
 * Small helpers shared by the comment composer and the inline editor.
 *
 * Why a plain text walk instead of `NodeApi.string`: the comment value can be
 * any Plate document, and the two things the UI needs are "did the writer type
 * anything" and "how close to the limit are they". A local walk keeps the
 * composer independent of the editor package internals.
 *
 * Used by: comment-composer.tsx, comment-item.tsx and the focused tabs.
 */

import {
	mentionPrefix,
	parseMentionKey,
} from "#/components/rich-text/mentions/mention-key";
import type { Comment } from "./api";

/**
 * The client mirror of the server text limit.
 *
 * Cosmetic only: the server rejects anything longer, and this copy is what lets
 * the counter and the disabled send button answer before the request is sent.
 */
export const COMMENT_TEXT_MAX = 5_000;

/** Walk an editor value and join its text leaves, with block boundaries kept. */
export function commentText(value: unknown[]): string {
	const parts: string[] = [];

	function walk(node: unknown): void {
		if (!node || typeof node !== "object") return;

		const record = node as Record<string, unknown>;

		// A mention is an inline void node. Its display name is the only text
		// that should count toward the preview and the character limit.
		if (record.type === "mention") {
			const target = parseMentionKey(record.key);
			const value = typeof record.value === "string" ? record.value : "";

			if (target && value) {
				parts.push(`${mentionPrefix(target.type)}${value}`);
			}

			return;
		}

		if (typeof record.text === "string") {
			parts.push(record.text);
			return;
		}

		if (Array.isArray(record.children)) {
			parts.push("\n");
			for (const child of record.children) walk(child);
			parts.push("\n");
		}
	}

	for (const node of value) walk(node);

	return parts
		.join("")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Node types that are complete content even without any text of their own. */
const EMBED_TYPES = new Set(["img", "file", "bookmark", "mention"]);

/**
 * True when the editor value has something worth sending.
 *
 * Text is not the only content: an image, an attachment or a bookmark card is a
 * complete comment on its own. Without this check the Post button stayed
 * disabled after a file upload, because the plain text walk found nothing.
 */
export function commentHasContent(value: unknown[]): boolean {
	let found = false;

	const walk = (node: unknown): void => {
		if (found || !node || typeof node !== "object") return;

		const record = node as Record<string, unknown>;

		if (typeof record.text === "string" && record.text.trim().length > 0) {
			found = true;
			return;
		}

		if (typeof record.type === "string" && EMBED_TYPES.has(record.type)) {
			found = true;
			return;
		}

		if (Array.isArray(record.children)) {
			for (const child of record.children) walk(child);
		}
	};

	for (const node of value) walk(node);

	return found;
}

/** True when the editor value changed in a way worth saving. */
export function isCommentChanged(
	next: unknown[],
	previous: unknown[],
): boolean {
	return JSON.stringify(next) !== JSON.stringify(previous);
}

/**
 * Short label and full title for a focused comment tab.
 *
 * The label is persisted so a tab can render before its thread has loaded. The
 * title carries the full first line for the hover tooltip.
 */
export function commentTabLabel(comment: Comment): {
	label: string;
	title: string;
} {
	const author = comment.author?.name ?? "Former member";
	const text = commentText(comment.body).replace(/\s+/g, " ").trim();

	if (text.length === 0) {
		return {
			label: `${author}: Attachment`,
			title: `${author}: attachment`,
		};
	}

	const short = text.length > 36 ? `${text.slice(0, 36)}...` : text;

	return { label: `${author}: ${short}`, title: `${author}: ${text}` };
}
