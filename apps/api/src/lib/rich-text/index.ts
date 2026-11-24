/**
 * Public surface of the rich text module.
 *
 * Why: services should import one entry point instead of reaching into the
 * sanitizer internals. The public surface is unchanged from the old
 * `rich-text/`.
 *
 * Used by: `services/milestone/`, `services/comment/` and the change request
 * services.
 */

export { sanitizeCommentBody, sanitizeOptionalCommentBody } from "./comment";
export type { SanitizedRichText } from "./constants";
export { sanitizeRichText } from "./core";
