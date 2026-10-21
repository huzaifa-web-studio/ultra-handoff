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

export const organizationSettingsSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, "Organization name is required")
		.max(64, "Name must be 64 characters or fewer"),
	slug: z
		.string()
		.trim()
		.min(3, "Slug must be at least 3 characters")
		.max(48, "Slug must be 48 characters or fewer")
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
