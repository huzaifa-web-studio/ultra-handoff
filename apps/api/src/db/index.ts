/**
 * Privileged database client.
 *
 * Why: this connection authenticates as the Postgres superuser (`app`), which
 * owns every table and therefore bypasses row level security. It exists for
 * the things that legitimately need cross-tenant access: migrations, the
 * Better Auth adapter (list orgs, accept invitations, setActive) and resolving
 * an organization slug to its id before a tenant scope exists.
 *
 * Rule: application services must never import this. Tenant data goes through
 * `withTenant` in src/db/tenant.ts, which runs as the unprivileged
 * `app_tenant` role and is subject to RLS.
 *
 * Used by: src/auth/**, src/middleware/tenant.ts, scripts/*.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseEnv } from "../lib/env";
import { dbSchema } from "./schema-bundle";

const adminClient = postgres(databaseEnv.url, {
	max: databaseEnv.poolMax,
});

export const adminDb = drizzle(adminClient, { schema: dbSchema });

export { adminClient };
export { authSchema, schema } from "./schema-bundle";
