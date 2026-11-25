/**
 * Validation for the optional profile fields on `user`.
 *
 * Why a Standard Schema object instead of Zod: the API does not depend on a
 * schema library. Better Auth only asks for the Standard Schema contract, so a
 * small object with one `validate` function is enough, and it keeps the field
 * limits next to the `additionalFields` declaration that uses them.
 *
 * The same three numbers appear in `apps/web/src/lib/limits.ts` for the form
 * counters and `maxLength` attributes. The API stays authoritative: the client
 * limits are a convenience, this validator is the boundary.
 *
 * Used by: `src/auth/auth.ts` (user.additionalFields).
 */

/** Longest accepted job title. */
export const PROFILE_JOB_TITLE_MAX = 80;

/** Longest accepted biography. */
export const PROFILE_BIO_MAX = 500;

/** Longest accepted location. */
export const PROFILE_LOCATION_MAX = 80;

/** The result shape Standard Schema expects from `validate`. */
type ProfileFieldResult =
	| { value: string | null }
	| { issues: Array<{ message: string }> };

/**
 * Build a validator for one optional, trimmed text field.
 *
 * Empty strings and missing values both store as null, so clearing a field in
 * the form removes it from the profile instead of saving whitespace. A value
 * that is too long is rejected here, not silently cut, so the person sees the
 * error and can shorten it.
 */
function optionalProfileField(max: number, label: string) {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "handoff",
			validate(value: unknown): ProfileFieldResult {
				if (value === null || value === undefined) return { value: null };

				if (typeof value !== "string") {
					return { issues: [{ message: `${label} must be text.` }] };
				}

				const trimmed = value.trim();

				if (trimmed.length > max) {
					return {
						issues: [
							{ message: `${label} must be ${max} characters or fewer.` },
						],
					};
				}

				return { value: trimmed.length === 0 ? null : trimmed };
			},
		},
	};
}

/** Job title, trimmed to null when empty. */
export const jobTitleField = optionalProfileField(
	PROFILE_JOB_TITLE_MAX,
	"Job title",
);

/** Biography, trimmed to null when empty. */
export const bioField = optionalProfileField(PROFILE_BIO_MAX, "Bio");

/** Location, trimmed to null when empty. */
export const locationField = optionalProfileField(
	PROFILE_LOCATION_MAX,
	"Location",
);
