/**
 * Validation for the organization General settings form.
 *
 * The API validates the same rules in `src/auth/permissions.ts`. This copy
 * exists so the user gets an inline error before a request is made, and so the
 * slug preview is trustworthy while typing.
 *
 * Used by: general-card.tsx.
 */

import { z } from "zod";

/** Root level routes or API prefixes an organization slug must not shadow. */
export const RESERVED_ORG_SLUGS = new Set([
	"account",
	"auth",
	"api",
	"delete-account",
	"reset-password",
	"settings",
	"invite",
	"accept-invitation",
	"health",
	"files",
	"uploads",
]);

/** Longest organization name the API accepts. */
export const ORG_NAME_MAX = 64;

/** Bounds the API enforces on an organization slug. */
export const ORG_SLUG_MIN = 3;
export const ORG_SLUG_MAX = 48;

export const organizationSettingsSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Organization name is required")
		.max(ORG_NAME_MAX, `Name must be ${ORG_NAME_MAX} characters or fewer`),
	slug: z
		.string()
		.trim()
		.min(ORG_SLUG_MIN, `Slug must be at least ${ORG_SLUG_MIN} characters`)
		.max(ORG_SLUG_MAX, `Slug must be ${ORG_SLUG_MAX} characters or fewer`)
		.regex(
			/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
			"Use lowercase letters, numbers and single hyphens",
		)
		.refine((value) => !RESERVED_ORG_SLUGS.has(value), {
			message: "This slug is reserved. Choose a different one.",
		}),
});

export type OrganizationSettingsValues = z.infer<
	typeof organizationSettingsSchema
>;
