/**
 * Milestone discussion search.
 *
 * Why this file: the comment timeline is long and the same "where did we say
 * that" question applies to it as to a chat. The search reads the plain text
 * mirror with the trigram index, so it never walks the JSON body.
 *
 * A hit points at its thread root, because that is what the reader can open as
 * a focused tab. A hit on a reply therefore opens the discussion the reply
 * belongs to.
 *
 * Used by: `routes/comments.ts`.
 */

import { and, desc, eq, ilike, isNull } from "drizzle-orm";

import { comment } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { escapeLike } from "../../lib/query";
import { normaliseSearchTerm, snippetAround } from "../../lib/search";
import type { TenantContext } from "../../middleware/tenant";
import { requireMilestoneAccess } from "../milestone";
import { loadPeople } from "./access";

/** One search hit in a milestone discussion. */
export type CommentSearchRow = {
	id: string;
	/** The thread the hit belongs to, which is the tab the reader can open. */
	rootId: string;
	authorName: string;
	authorImage: string | null;
	createdAt: string;
	snippet: string;
};

export type CommentSearchResult = {
	results: CommentSearchRow[];
	hasMore: boolean;
};

/** Search the visible messages of one milestone. */
export async function searchMilestoneComments(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
	query: { search: string; limit: number },
): Promise<CommentSearchResult> {
	const term = normaliseSearchTerm(query.search);

	if (!term) return { results: [], hasMore: false };

	const pattern = `%${escapeLike(term)}%`;

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await requireMilestoneAccess(tx, tenant, projectId, milestoneId);

			// One extra row tells the panel whether to ask for a narrower query.
			const rows = await tx
				.select()
				.from(comment)
				.where(
					and(
						eq(comment.organizationId, tenant.organizationId),
						eq(comment.milestoneId, milestoneId),
						eq(comment.kind, "comment"),
						isNull(comment.deletedAt),
						ilike(comment.bodyText, pattern),
					),
				)
				.orderBy(desc(comment.createdAt), desc(comment.id))
				.limit(query.limit + 1);

			const hasMore = rows.length > query.limit;
			const page = hasMore ? rows.slice(0, query.limit) : rows;
			const people = await loadPeople(page);

			return {
				results: page.map((record) => {
					const person = record.authorId
						? people.get(record.authorId)
						: undefined;

					return {
						id: record.id,
						rootId: record.parentId ?? record.id,
						authorName: person?.name || person?.email || "Former member",
						authorImage: person?.image ?? null,
						createdAt: record.createdAt.toISOString(),
						snippet: snippetAround(record.bodyText, term),
					};
				}),
				hasMore,
			};
		},
	);
}
