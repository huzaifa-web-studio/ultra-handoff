/**
 * In conversation search.
 *
 * Why this file: a long chat needs "where did we say that". The search reads
 * the plain text mirror with the trigram index, so it never walks the JSON body
 * and never touches a message the viewer cannot see.
 *
 * Used by: `routes/conversations.ts`.
 */

import { and, desc, eq, ilike, isNull } from "drizzle-orm";

import { conversationMessage } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { escapeLike } from "../../lib/query";
import { normaliseSearchTerm, snippetAround } from "../../lib/search";
import type { TenantContext } from "../../middleware/tenant";
import { loadPeople, requireConversation } from "./access";
import type { ConversationSearchResult } from "./types";

/** Search one conversation's messages. */
export async function searchConversationMessages(
	tenant: TenantContext,
	conversationId: string,
	query: { search: string; limit: number },
): Promise<ConversationSearchResult> {
	const term = normaliseSearchTerm(query.search);

	if (!term) return { results: [], hasMore: false };

	const pattern = `%${escapeLike(term)}%`;

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await requireConversation(tx, tenant, conversationId);

			// One extra row tells the panel whether to ask for a narrower query.
			const rows = await tx
				.select()
				.from(conversationMessage)
				.where(
					and(
						eq(conversationMessage.organizationId, tenant.organizationId),
						eq(conversationMessage.conversationId, conversationId),
						isNull(conversationMessage.deletedAt),
						ilike(conversationMessage.bodyText, pattern),
					),
				)
				.orderBy(
					desc(conversationMessage.createdAt),
					desc(conversationMessage.id),
				)
				.limit(query.limit + 1);

			const hasMore = rows.length > query.limit;
			const page = hasMore ? rows.slice(0, query.limit) : rows;
			const people = await loadPeople(
				tenant.organizationId,
				page.map((record) => record.authorId),
			);

			return {
				results: page.map((record) => {
					const person = record.authorId
						? people.get(record.authorId)
						: undefined;

					return {
						id: record.id,
						authorId: record.authorId,
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
