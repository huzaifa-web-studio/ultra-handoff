/**
 * Row level security checks.
 *
 * Why: RLS is invisible when it works and catastrophic when it silently does
 * not (for example if the tenant client ever fell back to the superuser).
 *
 * There are no business tables yet, so this script builds a throwaway probe
 * table with the same policy shape as src/db/rls.ts, proves the boundary with
 * it, and drops it again. Once real business tables exist, point the checks at
 * one of them instead.
 *
 * Run against a development database only. Requires `bun run db:bootstrap`.
 * Used by: `bun run db:verify-rls`.
 */

import { sql } from "drizzle-orm";
import { adminClient, adminDb } from "../src/db";
import { getTenantDb, withTenant } from "../src/db/tenant";

/** Postgres SQLSTATE for permission denied and RLS violations. */
const INSUFFICIENT_PRIVILEGE = "42501";

const PROBE_TABLE = "rls_probe_test";
const APP_ROLE = "app_tenant";

type CheckResult = {
	name: string;
	passed: boolean;
	detail: string;
};

const results: CheckResult[] = [];

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function pgErrorCode(error: unknown): string | undefined {
	if (typeof error === "object" && error !== null && "code" in error) {
		const { code } = error as { code?: unknown };
		return typeof code === "string" ? code : undefined;
	}
	return undefined;
}

function record(name: string, passed: boolean, detail: string): void {
	results.push({ name, passed, detail });
	process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${name}: ${detail}\n`);
}

/** Run a check that must succeed. */
async function check(name: string, fn: () => Promise<string>): Promise<void> {
	try {
		record(name, true, await fn());
	} catch (error) {
		record(name, false, describeError(error));
	}
}

/** Run an operation that must be rejected by Postgres. */
async function expectFailure(
	name: string,
	expectedCode: string,
	fn: () => Promise<unknown>,
): Promise<void> {
	try {
		await fn();
		record(name, false, `expected SQLSTATE ${expectedCode}, query succeeded`);
	} catch (error) {
		const code = pgErrorCode(error);
		if (code === expectedCode) {
			record(name, true, `rejected with SQLSTATE ${code}`);
			return;
		}
		record(
			name,
			false,
			`expected SQLSTATE ${expectedCode}, got ${code ?? describeError(error)}`,
		);
	}
}

/**
 * The role is created by scripts/bootstrap-db.ts. Fail early with a useful
 * message instead of a confusing "permission denied" later.
 */
async function assertRoleExists(): Promise<void> {
	const rows = await adminDb.execute<{ exists: boolean }>(
		sql`select exists (select 1 from pg_roles where rolname = ${APP_ROLE}) as exists`,
	);
	if (rows[0]?.exists !== true) {
		throw new Error(
			`Role ${APP_ROLE} is missing. Run "bun run db:bootstrap" first.`,
		);
	}
}

/**
 * Build the probe table with the exact policy shape tenantIsolation() emits.
 * Kept inline because this is the test harness, not schema.
 */
async function createProbe(): Promise<void> {
	const table = sql.identifier(PROBE_TABLE);
	const role = sql.identifier(APP_ROLE);

	await adminDb.execute(sql`drop table if exists ${table}`);
	await adminDb.execute(
		sql`create table ${table} (id text primary key, organization_id text not null)`,
	);
	await adminDb.execute(sql`alter table ${table} enable row level security`);
	await adminDb.execute(
		sql`create policy "tenant_isolation" on ${table}
			as permissive for all to ${role}
			using (organization_id = current_setting('app.current_org_id', true))
			with check (organization_id = current_setting('app.current_org_id', true))`,
	);
	await adminDb.execute(
		sql`grant select, insert, update, delete on ${table} to ${role}`,
	);
}

async function dropProbe(): Promise<void> {
	await adminDb.execute(sql`drop table if exists ${sql.identifier(PROBE_TABLE)}`);
}

async function main(): Promise<void> {
	await assertRoleExists();
	await createProbe();

	const orgA = "rls-org-a";
	const orgB = "rls-org-b";
	const rowA = "rls-row-a";
	const rowB = "rls-row-b";
	const scopeA = { organizationId: orgA, userId: "rls-test-user" };

	// Seed with the privileged client. This is setup, not a tenant query.
	await adminDb.execute(
		sql`insert into ${sql.identifier(PROBE_TABLE)} (id, organization_id)
			values (${rowA}, ${orgA}), (${rowB}, ${orgB})`,
	);

	try {
		// 1. Without a scope the tenant role learns nothing.
		await check("unscoped read returns no rows", async () => {
			const rows = await getTenantDb().execute<{ id: string }>(
				sql`select id from ${sql.identifier(PROBE_TABLE)}`,
			);
			if (rows.length !== 0) {
				throw new Error(`expected 0 rows, got ${rows.length}`);
			}
			return "0 rows";
		});

		// 2. With a scope, only that tenant is visible.
		await check("scoped read only sees its own tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ id: string; organization_id: string }>(
					sql`select id, organization_id from ${sql.identifier(PROBE_TABLE)}`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a row from another tenant");
			}
			return "1 row, own tenant only";
		});

		await check("explicit read of the other tenant is empty", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ id: string }>(
					sql`select id from ${sql.identifier(PROBE_TABLE)}
						where organization_id = ${orgB}`,
				),
			);
			if (rows.length !== 0) {
				throw new Error(`expected 0 rows, got ${rows.length}`);
			}
			return "0 rows";
		});

		// 3. Writes are checked, not just reads.
		await expectFailure(
			"insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into ${sql.identifier(PROBE_TABLE)} (id, organization_id)
							values (${"rls-intruder"}, ${orgB})`,
					),
				),
		);

		await check("update of a foreign row affects nothing", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ id: string }>(
					sql`update ${sql.identifier(PROBE_TABLE)} set organization_id = ${orgA}
						where id = ${rowB} returning id`,
				),
			);
			if (rows.length !== 0) {
				throw new Error(`expected 0 updated rows, got ${rows.length}`);
			}
			return "0 rows updated";
		});

		await check("delete of a foreign row affects nothing", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ id: string }>(
					sql`delete from ${sql.identifier(PROBE_TABLE)}
						where id = ${rowB} returning id`,
				),
			);
			if (rows.length !== 0) {
				throw new Error(`expected 0 deleted rows, got ${rows.length}`);
			}
			return "0 rows deleted";
		});

		// 4. Better Auth tables are not granted at all.
		await expectFailure(
			"Better Auth user table is not readable",
			INSUFFICIENT_PRIVILEGE,
			async () => getTenantDb().execute(sql`select count(*) from "user"`),
		);

		// 5. Sanity: the privileged client is unaffected, so the auth API and
		//    migrations keep working.
		await check("privileged client still sees every row", async () => {
			const rows = await adminDb.execute<{ id: string }>(
				sql`select id from ${sql.identifier(PROBE_TABLE)}`,
			);
			if (rows.length !== 2) {
				throw new Error(`expected 2 rows, got ${rows.length}`);
			}
			return "2 rows, RLS bypassed as designed";
		});
	} finally {
		await dropProbe();
		await adminClient.end({ timeout: 5 });
	}

	const failed = results.filter((result) => !result.passed);
	process.stdout.write(
		`\n${results.length - failed.length}/${results.length} checks passed\n`,
	);

	if (failed.length > 0) {
		process.exitCode = 1;
	}
}

await main();
