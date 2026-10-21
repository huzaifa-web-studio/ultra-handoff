/**
 * Validation for the create organization form.
 *
 * Shares the slug rules with the General settings form so a slug that would be
 * rejected by the API is caught before the dialog submits. The API validates
 * the same shape again in src/auth/permissions.ts.
 *
 * Used by: create-form.tsx.
 */

import { z } from "zod";

import { RESERVED_ORG_SLUGS } from "./settings/schema";

export const createOrganizationSchema = z.object({
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
