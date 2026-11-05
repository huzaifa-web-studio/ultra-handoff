/**
 * Mention search routes.
 *
 * Why a route of its own: the comment picker needs one small answer that spans
 * three entities (people in the project, visible projects and their milestones).
 * Reusing the project and milestone list endpoints for that would fetch pages of
 * rows the picker never shows and still could not search milestones across
 * projects in one request.
 *
 * The route only parses input and translates failures. The access rules live in
 * `mention.service.ts`, and the tenant macro guarantees `:orgSlug` was resolved
 * from a verified membership before the handler runs.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import {
	MENTION_RESULT_MAX,
	searchMentions,
} from "../services/mention.service";

/** Every mention search lives under one project. */
const mentionQuery = t.Object({
	projectId: t.String({ minLength: 1, maxLength: 64 }),
	search: t.Optional(t.String({ maxLength: 100 })),
	limit: t.Optional(t.String()),
});

/** Clamp the page size instead of trusting the browser. */
function parseLimit(limit?: string): number {
	const parsed = Number.parseInt(limit ?? "", 10);

	if (!Number.isFinite(parsed)) return 6;

	return Math.min(MENTION_RESULT_MAX, Math.max(1, parsed));
}

export const mentionRoutes = new Elysia({ name: "mentions" })
	.use(tenantPlugin)
	/** People in the project, visible projects and their milestones. */
	.get(
		"/orgs/:orgSlug/mentions",
		async ({ tenant, status, query }) => {
			try {
				return await searchMentions(tenant, query.projectId, {
					search: query.search ?? "",
					limit: parseLimit(query.limit),
				});
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not load mention suggestions.",
					),
				});
			}
		},
		{
			tenant: true,
			params: t.Object({
				orgSlug: t.String({ minLength: 1, maxLength: 255 }),
			}),
			query: mentionQuery,
		},
	);
