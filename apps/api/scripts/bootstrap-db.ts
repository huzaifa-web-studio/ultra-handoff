/**
 * Database bootstrap: create the unprivileged tenant role and grant it the
 * minimum it needs.
 *
 * Why this is a script and not a migration:
 *   1. `CREATE POLICY ... TO app_tenant` fails if the role does not exist, so
 *      the role must be created before `db:migrate` runs.
 *   2. The role password comes from the environment. Migrations are committed
 *      SQL applied verbatim everywhere, so a password cannot live there.
 *   3. drizzle-kit does not generate GRANT / REVOKE / ALTER DEFAULT PRIVILEGES.
 *   4. It must be idempotent, so it can run on every deploy and on volumes
 *      that already contain tables.
 *
 * Run order: db:bootstrap, then db:migrate.
 * Used by: the `migrate` service in compose files, and `bun run db:setup`.
 */

import postgres from "postgres";
import { databaseEnv } from "../src/lib/env";

/**
 * Business tables the tenant role may touch.
 *
 * Deliberately an allowlist rather than ALTER DEFAULT PRIVILEGES. A new table
 * that is not listed here fails loudly with "permission denied", which is much
 * safer than quietly granting access to a table that has no RLS policy.
 *
 * Better Auth tables are intentionally absent. `user`, `session`, `account`,
 * `verification`, `organization`, `member` and `invitation` belong to the auth
 * library and are only touched through its API on the privileged client.
 *
 * Add each new business table (with an RLS policy) to this list.
 */
const TENANT_TABLES: readonly string[] = [];

/** Identifiers cannot be bind parameters, so validate before quoting. */
function quoteIdent(identifier: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
		throw new Error(`Unsafe SQL identifier: ${identifier}`);
	}
	return `"${identifier}"`;
}

function parseAppCredentials(appUrl: string): {
	role: string;
	password: string;
} {
	if (!appUrl) {
		throw new Error(
			"DATABASE_APP_URL is required. It must point at the app_tenant role.",
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(appUrl);
	} catch {
		throw new Error("DATABASE_APP_URL is not a valid connection URL");
	}

	const role = decodeURIComponent(parsed.username);
	const password = decodeURIComponent(parsed.password);

	if (!role) {
		throw new Error("DATABASE_APP_URL is missing the role name");
	}
	if (!password) {
		throw new Error("DATABASE_APP_URL is missing the role password");
	}

	return { role, password };
}

async function main(): Promise<void> {
	if (!databaseEnv.url) {
		throw new Error("DATABASE_URL is required");
	}

	const { role, password } = parseAppCredentials(databaseEnv.appUrl);
	const quotedRole = quoteIdent(role);

	const admin = postgres(databaseEnv.url, { max: 1 });

	try {
		// 1. Role. Postgres has no CREATE ROLE IF NOT EXISTS, so check first.
		const roleRows =
			await admin<{ exists: boolean }[]>`select exists (
				select 1 from pg_roles where rolname = ${role}
			) as exists`;
		const roleExists = roleRows[0]?.exists === true;

		// Ask Postgres to quote the password instead of building the literal
		// ourselves. DO blocks cannot take bind parameters, hence this route.
		const passwordRows =
			await admin<{ literal: string }[]>`select quote_literal(${password}) as literal`;
		const passwordLiteral = passwordRows[0]?.literal;

		if (!passwordLiteral) {
			throw new Error("Failed to quote the app role password");
		}

		if (roleExists) {
			// Keep attributes and password in sync with the environment.
			await admin.unsafe(
				`alter role ${quotedRole} with login password ${passwordLiteral} nosuperuser nobypassrls nocreatedb nocreaterole`,
			);
			process.stdout.write(`[bootstrap] role ${role} updated\n`);
		} else {
			await admin.unsafe(
				`create role ${quotedRole} login password ${passwordLiteral} nosuperuser nobypassrls nocreatedb nocreaterole`,
			);
			process.stdout.write(`[bootstrap] role ${role} created\n`);
		}

		// 2. Schema access.
		await admin.unsafe(`grant usage on schema public to ${quotedRole}`);

		// 3. Default deny on everything, then allow the tenant tables only.
		await admin.unsafe(
			`revoke all on all tables in schema public from ${quotedRole}`,
		);
		await admin.unsafe(
			`revoke all on all sequences in schema public from ${quotedRole}`,
		);

		if (TENANT_TABLES.length > 0) {
			const tableList = TENANT_TABLES.map(quoteIdent).join(", ");
			await admin.unsafe(
				`grant select, insert, update, delete on table ${tableList} to ${quotedRole}`,
			);
			await admin.unsafe(
				`grant usage, select on all sequences in schema public to ${quotedRole}`,
			);
			process.stdout.write(
				`[bootstrap] granted tenant access to ${TENANT_TABLES.join(", ")}\n`,
			);
		} else {
			process.stdout.write(
				"[bootstrap] no business tables yet, tenant role has no table access\n",
			);
		}

		process.stdout.write(
			"[bootstrap] Better Auth tables stay revoked (managed by the auth API)\n",
		);
	} finally {
		await admin.end({ timeout: 5 });
	}
}

await main();
