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
 *   5. The trigram extension must exist before the generated GIN indexes that
 *      use `gin_trgm_ops` are applied by `db:migrate`.
 *
 * Run order: db:bootstrap, then db:migrate.
 * Used by: the `migrate` service in compose files, and `bun run db:setup`.
 */

import postgres from "postgres";
import { databaseEnv } from "../src/lib/env";

import { TENANT_TABLES } from "./tenant-tables";

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
		// 0. Trigram search support. Created before migrations because the
		// generated GIN indexes on project, milestone and user names reference
		// `gin_trgm_ops`.
		await admin.unsafe("create extension if not exists pg_trgm");
		process.stdout.write("[bootstrap] pg_trgm ready\n");

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

		/**
		 * Which tables exist right now. A fresh database runs bootstrap before
		 * migrations, so both the grants below and the cleanup function have to
		 * tolerate a table that is not there yet.
		 */
		const existingRows = await admin<{ tablename: string }[]>`
			select tablename from pg_tables where schemaname = 'public'
		`;
		const existing = new Set(existingRows.map((row) => row.tablename));

		if (TENANT_TABLES.length > 0) {
			/**
			 * A fresh database runs bootstrap before migrations, so a listed
			 * table may not exist yet. Granting it would fail the whole migrate
			 * job. Grant only what exists now; db:setup runs bootstrap once
			 * more after migrate, which picks up the new tables.
			 */
			const grantable = TENANT_TABLES.filter((name) => existing.has(name));
			const pending = TENANT_TABLES.filter((name) => !existing.has(name));

			if (grantable.length > 0) {
				const tableList = grantable.map(quoteIdent).join(", ");
				await admin.unsafe(
					`grant select, insert, update, delete on table ${tableList} to ${quotedRole}`,
				);
				await admin.unsafe(
					`grant usage, select on all sequences in schema public to ${quotedRole}`,
				);
				process.stdout.write(
					`[bootstrap] granted tenant access to ${grantable.join(", ")}\n`,
				);
			} else {
				process.stdout.write(
					"[bootstrap] no tenant tables exist yet, nothing granted\n",
				);
			}

			if (pending.length > 0) {
				process.stdout.write(
					`[bootstrap] waiting for migrations to create ${pending.join(", ")}\n`,
				);
			}
		} else {
			process.stdout.write(
				"[bootstrap] no business tables listed, tenant role has no table access\n",
			);
		}

		/**
		 * Cross recipient cleanup for a deleted comment.
		 *
		 * Why a definer function: the author of a comment deleting it must clear
		 * notifications that belong to many recipients, and the recipient only
		 * SELECT policy hides those rows from the author. A normal DELETE would
		 * match zero rows. This function runs as its owner, takes no
		 * organization parameter and reads the transaction setting instead, so
		 * it cannot be pointed at another workspace.
		 *
		 * Guarded on the table because a fresh database runs bootstrap before
		 * migrations; db:setup runs it again afterwards and creates it then.
		 */
		if (existing.has("notification")) {
			await admin.unsafe(`
				create or replace function public.delete_comment_notifications(p_comment_id text)
				returns integer
				language plpgsql
				security definer
				set search_path = public, pg_temp
				as $$
				declare
					deleted integer;
				begin
					delete from public.notification
					where comment_id = p_comment_id
						and organization_id = current_setting('app.current_org_id', true);
					get diagnostics deleted = row_count;
					return deleted;
				end;
				$$
			`);
			await admin.unsafe(
				`revoke all on function public.delete_comment_notifications(text) from public`,
			);
			await admin.unsafe(
				`grant execute on function public.delete_comment_notifications(text) to ${quotedRole}`,
			);
			process.stdout.write(
				"[bootstrap] delete_comment_notifications ready\n",
			);
		} else {
			process.stdout.write(
				"[bootstrap] waiting for migrations to create notification before the cleanup function\n",
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
