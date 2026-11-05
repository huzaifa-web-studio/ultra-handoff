/**
 * Mention keys and link building for the comment editor.
 *
 * Why a small module of its own: the editor, the read only renderer and the
 * picker all have to agree on how a stored mention turns into a prefix, an icon
 * and a URL. Restating that logic in three components is how a chip ends up
 * linking somewhere different from what the picker promised.
 *
 * The server sanitizer owns the real grammar. This file mirrors it for display
 * only, and still rejects a slug that is not a slug before it becomes a URL.
 *
 * Used by: mention-element.tsx, mention-input.tsx and comment-utils.ts.
 */

/** The entities a comment may mention. */
export type MentionType = "user" | "project" | "milestone";

/** The parsed form of a mention key. */
export type MentionTarget = {
	type: MentionType;
	id: string;
};

/** The stored fields of a mention node. */
export type MentionNode = {
	type: "mention";
	key: string;
	value: string;
	/** Project slug, present on project and milestone mentions. */
	slug?: string;
};

/** Key grammar. Matches the server allowlist. */
const MENTION_KEY_PATTERN = /^(user|project|milestone):([A-Za-z0-9_-]{1,64})$/;

/** A project slug is lowercase letters, numbers and single hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Read a mention key, or null for a value the server would not have stored. */
export function parseMentionKey(value: unknown): MentionTarget | null {
	if (typeof value !== "string") return null;

	const match = MENTION_KEY_PATTERN.exec(value);
	if (!match) return null;

	return {
		type: match[1] as MentionType,
		id: match[2] as string,
	};
}

/** Build the canonical key for one mention. */
export function mentionKey(type: MentionType, id: string): string {
	return `${type}:${id}`;
}

/** True when a stored project slug is safe to place in a URL. */
export function isSafeSlug(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 64 &&
		SLUG_PATTERN.test(value)
	);
}

/** The visible prefix for one mention type. */
export function mentionPrefix(type: MentionType): string {
	return type === "user" ? "@" : "#";
}

/** The readable label for one mention type, used in the picker groups. */
export function mentionTypeLabel(type: MentionType): string {
	if (type === "user") return "Person";
	if (type === "project") return "Project";

	return "Milestone";
}
