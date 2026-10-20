/**
 * Tenant-scoped database client.
 *
 * Why: row level security only applies to a role that is neither a superuser
 * nor the table owner. This client connects as `app_tenant`, so every query
 * runs against the policies declared in src/db/rls.ts.
 *
 * The tenant scope travels through Postgres settings (`app.current_org_id`
 * and `app.current_user_id`) that are written with `set_config(..., true)`.
 * The `true` means "local to this transaction", so a pooled connection can
 * never leak one request's organization into the next one.
 *
 * Used by: routes for tenant data. Services receive the transaction object
 * and never the privileged client.
 */

import type { ExtractTablesWithRelations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { databaseEnv } from "../lib/env";
import type { DbSchema } from "./schema-bundle";
import { dbSchema } from "./schema-bundle";

/**
 * The organization a request is allowed to read and write.
 * `organizationId` must be resolved from a verified membership, never from
 * user input.
 */
export type TenantScope = {
	organizationId: string;
	userId: string;
};

/** Client type for tenant queries. */
export type TenantDatabase = PostgresJsDatabase<DbSchema>;

/**
 * Transaction handed to services. It is a `PgTransaction`, which the
 * privileged `adminDb` is not assignable to, so a service written against
 * this type physically cannot receive the RLS-bypassing client.
 */
export type TenantTx = PgTransaction<
	PostgresJsQueryResultHKT,
	DbSchema,
	ExtractTablesWithRelations<DbSchema>
>;

let tenantDbInstance: TenantDatabase | null = null;

/**
 * Lazily build the tenant client so the process can boot (and run migrations
 * or scripts) without `DATABASE_APP_URL`. It throws loudly on first use
 * instead of silently falling back to the privileged connection.
 */
export function getTenantDb(): TenantDatabase {
	if (tenantDbInstance) return tenantDbInstance;

	const url = databaseEnv.appUrl;
	if (!url) {
		throw new Error(
			"DATABASE_APP_URL is not set. Tenant queries require the app_tenant role (run db:bootstrap).",
		);
	}

	const client = postgres(url, { max: databaseEnv.poolMax });
	tenantDbInstance = drizzle(client, { schema: dbSchema });
	return tenantDbInstance;
}

/**
 * Validate an id before it becomes a Postgres setting. Values are always
 * passed as bind parameters, so this is not about injection: it catches empty
 * or absurd values that would silently scope a request to nothing.
 */
function assertScopeValue(value: string, label: string): void {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Tenant scope is missing ${label}`);
	}
	if (value.length > 255) {
		throw new Error(`Tenant scope ${label} is too long`);
	}
}

/**
 * Run `fn` inside a transaction scoped to one organization.
 *
 * Everything inside the callback is subject to the tenant policies. Nothing
 * outside it is. Keep slow work (mail, storage, HTTP) out of the callback so
 * the transaction stays short.
 */
export async function withTenant<T>(
	scope: TenantScope,
	fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
	assertScopeValue(scope.organizationId, "organizationId");
	assertScopeValue(scope.userId, "userId");

	return getTenantDb().transaction(async (tx) => {
		// Set both settings in one round trip and read them back. The echo proves
		// the scope actually landed before any tenant query runs.
		const applied = await tx.execute<{ org: string; usr: string }>(
			sql`select
				set_config('app.current_org_id', ${scope.organizationId}, true) as org,
				set_config('app.current_user_id', ${scope.userId}, true) as usr`,
		);

		const row = applied[0];
		if (row?.org !== scope.organizationId || row?.usr !== scope.userId) {
			throw new Error("Failed to apply the tenant scope");
		}

		return fn(tx);
	});
}
