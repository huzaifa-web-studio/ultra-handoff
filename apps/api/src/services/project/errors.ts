/**
 * Project write error classification.
 *
 * Why this file: create and update both have to turn a database unique
 * violation into a readable 400 for the slug or the member pair. One helper
 * keeps those messages consistent.
 *
 * Used by: the write modules in `services/project/`.
 */

/** Translate a duplicate key error into a friendly slug or member message. */
export function isUniqueViolation(
	error: unknown,
	constraint?: string,
): boolean {
	// Drizzle wraps driver failures in a DrizzleQueryError, so the SQLSTATE and
	// the constraint name live on the cause chain, not on the top level error.
	let current: unknown = error;

	for (let depth = 0; depth < 5; depth += 1) {
		if (typeof current !== "object" || current === null) return false;

		const candidate = current as {
			code?: unknown;
			constraint?: unknown;
			constraint_name?: unknown;
		};

		if (candidate.code === "23505") {
			if (!constraint) return true;

			// postgres-js exposes the Postgres field as `constraint_name`,
			// while other drivers use `constraint`. Accept both.
			return (
				candidate.constraint === constraint ||
				candidate.constraint_name === constraint
			);
		}

		current = (current as { cause?: unknown }).cause;
	}

	return false;
}
