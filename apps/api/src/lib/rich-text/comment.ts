/**
 * Comment rich text profile.
 *
 * Why this file: a comment is a message and only allows the lighter block set,
 * with its own caps and an empty body rule. Keeping it apart from the milestone
 * brief makes that narrower trust explicit.
 *
 * Used by: `services/comment/`.
 */

import { APIError } from "better-auth/api";
import type { SanitizedRichText } from "./constants";
import { COMMENT_PROFILE } from "./constants";
import { sanitizeProfile } from "./core";
import { isRecord } from "./urls";

/**
 * Block types that count as content even with no text of their own.
 *
 * An image, an attachment, a bookmark card and a mention are complete messages.
 * A table or an empty list is structural, so it still needs a word to be worth
 * sending.
 */
const COMMENT_EMBED_TYPES = new Set(["img", "file", "bookmark", "mention"]);

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
 *
 * The empty body copy is caller supplied because a direct message is not a
 * comment. The sanitizer stays shared, only the wording changes.
 */
export function sanitizeCommentBody(
	value: unknown,
	emptyMessage = "Write something before posting your comment.",
): SanitizedRichText {
	const sanitized = sanitizeProfile(value, COMMENT_PROFILE);

	if (!hasCommentContent(sanitized.value)) {
		throw new APIError("BAD_REQUEST", {
			message: emptyMessage,
		});
	}

	return sanitized;
}

/**
 * Validate and clean an optional rich text body.
 *
 * Why a variant: a change request is titled, and the detail is optional. The
 * title carries the ask, so an empty body is a complete request rather than a
 * mistake. The profile and the limits are the same as a comment.
 */
export function sanitizeOptionalCommentBody(value: unknown): SanitizedRichText {
	return sanitizeProfile(value, COMMENT_PROFILE);
}
