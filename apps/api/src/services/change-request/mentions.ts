/**
 * Mention id extraction for change request bodies.
 *
 * Why this file: create and update both diff mention ids around a body change,
 * so the extraction has to be identical on both paths.
 *
 * Used by: `create.ts` and `update.ts`.
 */

import { collectMentionKeys } from "../../lib/mentions";

/** The user ids mentioned in one rich text body. */
export function mentionedUserIds(body: unknown[]): Set<string> {
	return new Set(
		collectMentionKeys(body)
			.filter((mention) => mention.type === "user")
			.map((mention) => mention.id),
	);
}
