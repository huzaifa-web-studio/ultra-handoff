/**
 * Row level security helpers for business tables.
 *
 * Scope: business data only. Better Auth owns `user`, `session`, `account`,
 * `verification`, `organization`, `member` and `invitation`. Those tables are
 * internal to the auth library, which reads across organizations (list my
 * organizations, accept an invitation, setActive), so they stay on the
 * privileged client and carry no policies. Nothing about them belongs here.
 *
 * Business tables (`project`, `client`, `deliverable`, ...) each carry
 * `organization_id` and use `tenantIsolation(...)`, so the rule lives in one
 * place instead of being copy-pasted per table.
 *
 * Used by: business tables in src/db/.
 */

import { sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { pgPolicy, pgRole } from "drizzle-orm/pg-core";

/**
 * Unprivileged role that business queries run as.
 *
 * The `app` role is a superuser and owns these tables, so Postgres always
 * bypasses RLS for it (even with FORCE ROW LEVEL SECURITY). The policy below
 * is only meaningful for a role that is neither superuser nor table owner,
 * which is exactly what `app_tenant` is.
 *
 * `.existing()` tells drizzle-kit the role is created by
 * scripts/bootstrap-db.ts, so it must never emit CREATE ROLE itself (the
 * password comes from the environment, not from a committed migration).
 */
export const appRole = pgRole("app_tenant").existing();

/**
 * Build the standard tenant isolation policy for a column.
 *
 * `current_setting('app.current_org_id', true)` returns NULL when the setting
 * is missing, so the comparison is NULL and Postgres filters the row out.
 * That is intentional: forgetting the tenant scope returns zero rows instead
 * of every row.
 */
export function tenantIsolation(column: PgColumn) {
	return pgPolicy("tenant_isolation", {
		as: "permissive",
		for: "all",
		to: appRole,
		using: sql`${column} = current_setting('app.current_org_id', true)`,
		withCheck: sql`${column} = current_setting('app.current_org_id', true)`,
	});
}
