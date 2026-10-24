/**
 * Small SQL helpers shared by more than one service.
 *
 * Why: a search box must treat user input as text, not as a LIKE pattern. The
 * same escape is needed by the projects list and the milestones list, so it
 * lives here instead of being copied into both services.
 *
 * Used by: src/services/project.service.ts, src/services/milestone.service.ts.
 */

/**
 * Escape the three characters that have meaning inside a LIKE pattern.
 *
 * Without this, a search for "50%" would match everything, and a trailing
 * backslash would produce an invalid pattern that Postgres rejects. The
 * backslash is escaped first so the escapes added afterwards are not doubled.
 */
export function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, "\\$&");
}
