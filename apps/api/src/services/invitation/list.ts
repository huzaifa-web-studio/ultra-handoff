/**
 * Invitation history.
 *
 * Why this file: the history page is the only read that filters, sorts and
 * pages on the privileged client. Keeping the SQL status derivation and the
 * filters together is what keeps the chips and the rows consistent.
 *
 * Used by: `routes/members.ts`.
 */

import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import { adminDb } from "../../db";
import { invitation } from "../../db/auth-schema";
import { escapeLike } from "../../lib/query";
import type { TenantContext } from "../../middleware/tenant";
import {
	assertManager,
	derivedStatusSql,
	loadUsers,
	statusFilterSql,
} from "./helpers";
import type {
	InvitationHistoryItem,
	InvitationHistoryQuery,
	InvitationHistoryResult,
	InvitationStatus,
} from "./types";

/**
 * Paginated invitation history.
 *
 * Filtering, sorting, counting and paging happen in Postgres. The status
 * counts describe the role and search scope, not the current page, so the
 * filter labels stay useful while one status is selected. The page query
 * applies the status filter and returns at most `pageSize` rows.
 *
 * The `invitation` table is owned by Better Auth, so it is read on the
 * privileged client and never joined into a tenant query.
 */
export async function listInvitationHistory(
	tenant: TenantContext,
	query: InvitationHistoryQuery,
): Promise<InvitationHistoryResult> {
	assertManager(tenant.role);

	// The Role column shows the first role in Better Auth's comma separated
	// value, so the filter compares that same part.
	const primaryRole = sql<string>`btrim(split_part(coalesce(${invitation.role}, 'member'), ',', 1))`;
	const search = query.search.trim();
	const searchPattern = search.length > 0 ? `%${escapeLike(search)}%` : null;

	const scope = and(
		eq(invitation.organizationId, tenant.organizationId),
		query.role === "all" ? undefined : eq(primaryRole, query.role),
		searchPattern ? ilike(invitation.email, searchPattern) : undefined,
	);

	const statusSql = derivedStatusSql();

	// One grouped read gives every status bucket, and their sum is the scope
	// total. The page total is one bucket when a status is selected.
	const countRows = await adminDb
		.select({
			status: statusSql,
			count: sql<number>`count(*)`.mapWith(Number),
		})
		.from(invitation)
		.where(scope)
		.groupBy(statusSql);

	const counts: InvitationHistoryResult["counts"] = {
		all: 0,
		pending: 0,
		expired: 0,
		accepted: 0,
		canceled: 0,
		rejected: 0,
	};

	for (const row of countRows) {
		if (
			row.status === "pending" ||
			row.status === "expired" ||
			row.status === "accepted" ||
			row.status === "canceled" ||
			row.status === "rejected"
		) {
			counts[row.status] = row.count;
		}

		counts.all += row.count;
	}

	const total = query.status === "all" ? counts.all : counts[query.status];
	const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
	const page = Math.min(Math.max(1, query.page), totalPages);
	const offset = (page - 1) * query.pageSize;

	// `lower(email)` mirrors the old case-insensitive comparison, and the id
	// tiebreaker keeps equal keys in a stable order across pages.
	const sortSql =
		query.sort === "email"
			? sql`lower(${invitation.email})`
			: query.sort === "expiresAt"
				? sql`${invitation.expiresAt}`
				: query.sort === "status"
					? statusSql
					: sql`${invitation.createdAt}`;
	const order = query.direction === "asc" ? asc(sortSql) : desc(sortSql);

	const rows = await adminDb
		.select({
			id: invitation.id,
			email: invitation.email,
			role: invitation.role,
			status: statusSql,
			createdAt: invitation.createdAt,
			expiresAt: invitation.expiresAt,
			inviterId: invitation.inviterId,
		})
		.from(invitation)
		.where(
			and(
				scope,
				query.status === "all" ? undefined : statusFilterSql(query.status),
			),
		)
		.orderBy(order, asc(invitation.id))
		.limit(query.pageSize)
		.offset(offset);

	// Only the page's inviters are resolved, never the whole history.
	const inviters = await loadUsers([
		...new Set(rows.map((row) => row.inviterId)),
	]);

	const items: InvitationHistoryItem[] = rows.map((row) => {
		const inviter = inviters.get(row.inviterId);

		return {
			id: row.id,
			email: row.email,
			role: row.role ?? "member",
			status: row.status as InvitationStatus,
			createdAt: new Date(row.createdAt).toISOString(),
			expiresAt: new Date(row.expiresAt).toISOString(),
			inviterName: inviter?.name || inviter?.email || "Former member",
			inviterEmail: inviter?.email ?? "",
		};
	});

	return {
		organizationId: tenant.organizationId,
		items,
		pagination: {
			page,
			pageSize: query.pageSize,
			total,
			totalPages,
			hasNext: page < totalPages,
			hasPrevious: page > 1,
		},
		counts,
		viewer: { role: tenant.role },
	};
}
