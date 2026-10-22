/**
 * Validation for the project form.
 *
 * The API validates the same rules in `apps/api/src/auth/project-permissions.ts`.
 * This copy exists so the user gets an inline error before a request is made,
 * and so the slug suggestion is trustworthy while typing.
 *
 * Used by: project-dialog.tsx.
 */

import { z } from "zod";

export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 300;
export const PROJECT_SLUG_MIN = 3;
export const PROJECT_SLUG_MAX = 48;

/** Control words a future project detail route must keep free. */
export const RESERVED_PROJECT_SLUGS = new Set([
	"new",
	"settings",
	"archive",
	"archived",
]);

export const projectSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Project name is required")
		.max(
			PROJECT_NAME_MAX,
			`Name must be ${PROJECT_NAME_MAX} characters or fewer`,
		),
	slug: z
		.string()
		.trim()
		.min(
			PROJECT_SLUG_MIN,
			`Slug must be at least ${PROJECT_SLUG_MIN} characters`,
		)
		.max(
			PROJECT_SLUG_MAX,
			`Slug must be ${PROJECT_SLUG_MAX} characters or fewer`,
		)
		.regex(
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
			"Use lowercase letters, numbers and single hyphens",
		)
		.refine((value) => !RESERVED_PROJECT_SLUGS.has(value), {
			message: "This slug is reserved. Choose a different one.",
		}),
	description: z
		.string()
		.trim()
		.max(
			PROJECT_DESCRIPTION_MAX,
			`Description must be ${PROJECT_DESCRIPTION_MAX} characters or fewer`,
		),
});

export type ProjectFormValues = z.infer<typeof projectSchema>;

/**
 * Suggest a slug from the project name.
 *
 * Diacritics are folded before the non alphanumeric pass so "Café" becomes
 * "cafe" instead of "caf". The result is trimmed to the same maximum the API
 * enforces, with a trailing hyphen removed.
 */
export function slugifyProjectName(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, PROJECT_SLUG_MAX)
		.replace(/-+$/g, "");
}
