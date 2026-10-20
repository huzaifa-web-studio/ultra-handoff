/**
 * Tenant resolution for HTTP requests.
 *
 * Why: row level security compares rows against `app.current_org_id`, so that
 * value has to come from somewhere trustworthy. This plugin is that place. It
 * turns the `:orgSlug` path parameter into a verified organization id by
 * checking the caller's membership, and nothing else is allowed to set the
 * scope.
 *
 * Security note: the URL slug is authoritative, not `session.active_organization_id`.
 * The active org is a UI convenience and can be stale across tabs. RLS alone
 * cannot catch a forged scope (it only compares ids), which is why the
 * membership check happens here, on the privileged client, before any tenant
 * query runs.
 *
 * Used by: routes that declare `{ tenant: true }`.
 */

import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { auth } from "../auth/auth";
import { adminDb } from "../db";
import { member, organization } from "../db/auth-schema";
import type { TenantScope } from "../db/tenant";

/** Verified tenant for the current request. */
export type TenantContext = TenantScope & {
	slug: string;
	role: string;
};

export type TenantResolution =
	| { kind: "ok"; tenant: TenantContext }
	| { kind: "unauthenticated" }
	| { kind: "not-found" };

/**
 * Resolve `:orgSlug` to an organization the caller actually belongs to.
 *
 * Returns "not-found" for organizations the caller is not a member of, so the
 * API does not reveal whether a slug exists.
 */
export async function resolveTenantScope(
	headers: Headers,
	orgSlug: string,
): Promise<TenantResolution> {
	const session = await auth.api.getSession({ headers });
	if (!session) return { kind: "unauthenticated" };

	const [row] = await adminDb
		.select({
			organizationId: organization.id,
			slug: organization.slug,
			role: member.role,
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.where(
			and(eq(member.userId, session.user.id), eq(organization.slug, orgSlug)),
		)
		.limit(1);

	if (!row) return { kind: "not-found" };

	return {
		kind: "ok",
		tenant: {
			organizationId: row.organizationId,
			userId: session.user.id,
			slug: row.slug,
			role: row.role,
		},
	};
}

/**
 * Elysia plugin exposing the `tenant` macro.
 *
 * Usage:
 *   .get("/orgs/:orgSlug/projects", handler, { tenant: true })
 *
 * The handler receives `tenant` and passes it to `withTenant`.
 */
export const tenantPlugin = new Elysia({ name: "tenant" }).macro({
	tenant: {
		async resolve({ status, request, params }) {
			const orgSlug = (params as unknown as Record<string, string | undefined>)
				.orgSlug;

			if (!orgSlug) return status(400);

			const resolution = await resolveTenantScope(request.headers, orgSlug);

			if (resolution.kind === "unauthenticated") return status(401);
			if (resolution.kind === "not-found") return status(404);

			return { tenant: resolution.tenant };
		},
	},
});
