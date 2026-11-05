/**
 * Mention key parsing and limits.
 *
 * Why this file exists: an `@mention` is stored inside the rich text body as a
 * small inline node. The key is the only machine readable part of that node, so
 * the sanitizer, the service that checks access and any future feature all have
 * to agree on its shape. Keeping the grammar in one place means a malformed key
 * can never be interpreted two ways.
 *
 * Format: `<type>:<id>`, for example `user:abc123` or `milestone:xyz789`.
 * The type allowlist is deliberately closed. An unknown type is dropped rather
 * than rendered, so a crafted body cannot invent a new kind of chip.
 *
 * Used by: src/lib/rich-text.ts and src/services/mention.service.ts.
 */

/** The entities a comment may mention. */
export const MENTION_TYPES = ["user", "project", "milestone"] as const;

/** One of the supported mention entities. */
export type MentionType = (typeof MENTION_TYPES)[number];

/** The parsed form of a mention key. */
export type ParsedMention = {
	type: MentionType;
	id: string;
};

/**
 * Longest display name stored on a mention node.
 *
 * A project or milestone title is capped well below this in the app, so the
 * value is a safety limit rather than a real product limit.
 */
export const MAX_MENTION_NAME = 160;

/** Longest project slug stored on a project or milestone mention. */
export const MENTION_SLUG_MAX = 64;

/**
 * A project slug is lowercase letters, numbers and single hyphens.
 *
 * Mirrors `PROJECT_SLUG_PATTERN` in the project permissions module. The mention
 * sanitizer cannot import that module without pulling API errors and limits
 * into a pure walk, so the shape is restated here.
 */
export const MENTION_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Key grammar. Ids are opaque strings, never arbitrary text. */
const MENTION_KEY_PATTERN = /^(user|project|milestone):([A-Za-z0-9_-]{1,64})$/;

/** True for a plain object, not an array or null. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a mention key.
 *
 * Returns null for anything that did not come from the editor: a missing key, a
 * type outside the allowlist or an id with unexpected characters.
 */
export function parseMentionKey(value: unknown): ParsedMention | null {
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

/**
 * Collect every mention key in a sanitized rich text body.
 *
 * Duplicates are collapsed, because the same person can be mentioned twice in
 * one message and the caller only needs to check each target once.
 */
export function collectMentionKeys(value: unknown[]): ParsedMention[] {
	const found = new Map<string, ParsedMention>();

	const walk = (node: unknown): void => {
		if (!isRecord(node)) return;

		if (node.type === "mention") {
			const parsed = parseMentionKey(node.key);

			if (parsed) {
				const key = mentionKey(parsed.type, parsed.id);
				found.set(key, parsed);
			}

			return;
		}

		if (Array.isArray(node.children)) {
			for (const child of node.children) walk(child);
		}
	};

	for (const node of value) walk(node);

	return [...found.values()];
}
