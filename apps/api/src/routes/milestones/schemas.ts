/**
 * Milestone route schemas.
 *
 * Why this file: every handler validates the same params, dates and fields.
 * Keeping the schemas together means one route cannot drift from another.
 *
 * Used by: `routes/milestones/index.ts`.
 */

import { t } from "elysia";
import {
	MILESTONE_ASSIGNEE_MAX,
	MILESTONE_ESTIMATE_MAX,
	MILESTONE_NOTE_MAX,
	MILESTONE_STATUSES,
} from "../../auth/milestone-permissions";

export const milestoneParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	milestoneId: t.String({ minLength: 1, maxLength: 64 }),
});

/** Params for the collection routes, which have no milestone id yet. */
export const projectParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
});

/** One scope section inside a milestone. */
export const scopeEntryParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	milestoneId: t.String({ minLength: 1, maxLength: 64 }),
	entryId: t.String({ minLength: 1, maxLength: 64 }),
});

export const milestoneQuery = t.Object({
	search: t.Optional(t.String({ maxLength: 100 })),
	status: t.Optional(t.String()),
	sort: t.Optional(t.String()),
	direction: t.Optional(t.String()),
	page: t.Optional(t.String()),
	pageSize: t.Optional(t.String()),
});

/**
 * A date arrives as `YYYY-MM-DD`, an empty string or null.
 *
 * The empty string is how the client clears a field through PATCH, matching
 * the convention the project routes already use for descriptions and logos.
 */
export const dateField = t.Optional(
	t.Union([t.String({ maxLength: 10 }), t.Null()]),
);

export const estimateField = t.Optional(
	t.Union([
		t.Integer({ minimum: 1, maximum: MILESTONE_ESTIMATE_MAX }),
		t.Null(),
	]),
);

/**
 * The editor value.
 *
 * Deliberately untyped at the HTTP layer: the shape is a Plate document, and
 * the sanitizer in the service is the authority on what is accepted. A schema
 * here would have to be duplicated and kept in sync with the editor.
 */
export const descriptionField = t.Optional(t.Unknown());

export const assigneeField = t.Optional(
	t.Array(t.String({ minLength: 1, maxLength: 64 }), {
		maxItems: MILESTONE_ASSIGNEE_MAX,
	}),
);

/** An optional prose note attached to a timeline event. */
export const noteField = t.Optional(
	t.Union([t.String({ maxLength: MILESTONE_NOTE_MAX }), t.Null()]),
);

/**
 * One optional status value.
 *
 * Why the explicit `default: undefined`: `t.UnionEnum` normally injects the
 * first enum value when the property is missing, so a PATCH that only changed a
 * date silently reset the status to "todo". Overriding the helper's default
 * keeps a missing status missing while preserving the inferred union type.
 */
export const statusField = t.UnionEnum(MILESTONE_STATUSES, {
	default: undefined,
});

export const MILESTONE_SORTS = ["dueDate", "createdAt", "title"] as const;

export const MILESTONE_FILTERS = [
	"all",
	"active",
	...MILESTONE_STATUSES,
] as const;

/** Clamp the query strings instead of trusting the browser. */
