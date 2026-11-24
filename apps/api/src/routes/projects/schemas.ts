/**
 * Project route schemas.
 *
 * Why this file: every handler validates the same params, bulk ids and list
 * filters. Keeping the schemas together means one route cannot drift from
 * another.
 *
 * Used by: `routes/projects/index.ts`.
 */

import { t } from "elysia";
import { BULK_SELECTION_MAX } from "../../auth/permissions";

export const projectParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
});

/**
 * A slug is the readable public identifier, so it lives in the URL.
 * The length matches the create and update validation.
 */
export const projectSlugParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectSlug: t.String({ minLength: 1, maxLength: 100 }),
});

export const projectMemberParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	userId: t.String({ minLength: 1, maxLength: 64 }),
});

export const projectQuery = t.Object({
	search: t.Optional(t.String({ maxLength: 100 })),
	status: t.Optional(t.String()),
	sort: t.Optional(t.String()),
	direction: t.Optional(t.String()),
	page: t.Optional(t.String()),
	pageSize: t.Optional(t.String()),
});

export const PROJECT_STATUSES = ["all", "active", "archived"] as const;
export const PROJECT_SORTS = ["name", "createdAt", "updatedAt"] as const;

/**
 * A batch of ids in one request.
 *
 * Capped at the same limit the members bulk routes use, so no single request
 * can turn into an unbounded loop.
 */
export const idList = t.Array(t.String({ minLength: 1, maxLength: 64 }), {
	minItems: 1,
	maxItems: BULK_SELECTION_MAX,
});

/** Clamp query strings instead of trusting the browser. */
