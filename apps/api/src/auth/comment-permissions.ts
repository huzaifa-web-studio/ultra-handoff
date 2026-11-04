/**
 * Comment vocabulary, limits and permission rules.
 *
 * Why a separate module: the service, the routes and the mirrored web limits
 * all need the same numbers, and the rules about who may comment and who may
 * change a comment must be identical on every route. One module keeps them from
 * drifting apart, exactly like `milestone-permissions.ts` does for milestones.
 *
 * The browser copy of the limits is cosmetic. Every write is validated here,
 * on the server, before it reaches Postgres.
 *
 * Used by: src/lib/rich-text.ts, src/services/comment.service.ts and
 * src/routes/comments.ts.
 */

import { APIError } from "better-auth/api";
import { effectiveProjectRole } from "./project-permissions";

/**
 * Largest accepted rich text payload, measured as serialized JSON characters.
 *
 * A comment can now carry tables, images and attachments, so the cap is well
 * above a few paragraphs of prose while staying below the milestone description
 * cap. Only references are stored here, never file bytes, so this is generous
 * rather than risky.
 */
export const COMMENT_BODY_MAX = 100_000;

/** Largest plain text mirror kept for previews and validation. */
export const COMMENT_TEXT_MAX = 5_000;

/** Most comments one person may post in one milestone per minute. */
export const COMMENT_RATE_LIMIT = 20;

/** Length of the rate limit window, in seconds. */
export const COMMENT_RATE_WINDOW = 60;

/**
 * True when the caller may post on this project.
 *
 * Everyone on the project participates in the discussion, including the
 * `client` role. Milestone authoring stays staff only, but the client facing
 * conversation is the whole point of this surface, so a client must be able to
 * write here.
 *
 * Archived projects are handled by `assertProjectActive` before this runs, so
 * this stays a pure role question.
 */
export function canCommentOnProject(
	organizationRole: string,
	projectRole: string | null | undefined,
): boolean {
	return effectiveProjectRole(organizationRole, projectRole) !== null;
}

/**
 * True when this caller may change or delete one comment.
 *
 * Author only. There is no moderator path in the first version: the record of
 * who said what stays honest, and a comment can only be changed by the person
 * who wrote it.
 */
export function canModifyComment(input: {
	viewerId: string;
	authorId: string | null;
	deletedAt: Date | null;
	locked: boolean;
}): boolean {
	return (
		input.authorId !== null &&
		input.authorId === input.viewerId &&
		input.deletedAt === null &&
		!input.locked
	);
}

/**
 * Reject a comment write from someone with no role on the project.
 *
 * Mirrors the milestone guard so the two services answer the same way and the
 * client never has to guess from a status code alone.
 */
export function assertCanComment(
	organizationRole: string,
	projectRole: string | null | undefined,
): void {
	if (!canCommentOnProject(organizationRole, projectRole)) {
		throw new APIError("FORBIDDEN", {
			message: "You can read this discussion but not take part in it.",
		});
	}
}

/**
 * Reject a comment change by someone other than its author.
 *
 * A deleted comment is read only for everyone, including its author, because
 * the content is already gone.
 */
export function assertCanModifyComment(input: {
	viewerId: string;
	authorId: string | null;
	deletedAt: Date | null;
	locked: boolean;
}): void {
	if (input.deletedAt !== null) {
		throw new APIError("BAD_REQUEST", {
			message: "That comment was deleted and can no longer be changed.",
		});
	}

	if (!canModifyComment(input)) {
		throw new APIError("FORBIDDEN", {
			message: "Only the person who wrote a comment can change it.",
		});
	}
}
