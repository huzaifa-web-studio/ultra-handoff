/**
 * One command runner for the integration suite.
 *
 * Why this exists: creating `app_test`, running `db:setup` and passing the
 * env vars by hand is error prone, and the phase 2 report flagged it as a
 * manual setup. This script creates the database if it is missing, bootstraps
 * and migrates it, runs the suite, and optionally drops the database again.
 *
 * Safety: the same guard as the test suite itself. Every connection URL must
 * point at a database whose name ends in `app_test`, so this can never touch
 * the development database. Run it from `apps/api`.
 *
 * Usage:
 *   bun run test:db            # create (if needed), setup, test
 *   bun run test:db -- --drop  # ...and drop the database afterwards
 *
 * Used by: `bun run test:db` (apps/api) and `bun run test:db` (repo root).
 */
import { spawnSync } from "node:child_process";

const APP_TEST_SUFFIX = "app_test";

/** The database name is the last path segment of the connection URL. */
function databaseName(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Not a valid connection URL: ${url}`);
	}
	return parsed.pathname.replace(/^\//, "");
}

function assertTestDatabase(url: string, label: string): void {
	const name = databaseName(url);
	if (!name.endsWith(APP_TEST_SUFFIX)) {
		throw new Error(
			`${label} must point at a database whose name ends in "${APP_TEST_SUFFIX}" (got "${name}"). Refusing to run.`,
		);
	}
}

const adminUrl = (
	process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app_test"
).replace(/\/[^/]*$/, "/postgres");

const databaseUrl =
	process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app_test";
const appUrl =
	process.env.DATABASE_APP_URL ??
	"postgres://app_tenant:tenant@localhost:5432/app_test";

assertTestDatabase(databaseUrl, "DATABASE_URL");
assertTestDatabase(appUrl, "DATABASE_APP_URL");

const shouldDrop = process.argv.includes("--drop");
const targetDatabase = databaseName(databaseUrl);

/** Run a command with the test environment, inheriting stdio. */
function run(command: string, args: string[]): number {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		env: {
			...process.env,
			TEST_DATABASE: "1",
			DATABASE_URL: databaseUrl,
			DATABASE_APP_URL: appUrl,
		},
	});
	if (result.error) {
		throw result.error;
	}
	return result.status ?? 1;
}

async function ensureDatabaseExists(): Promise<void> {
	// postgres-js is a dependency of the API, so use it for the one admin call
	// instead of shelling out to psql, which may not be installed.
	const { default: postgres } = await import("postgres");
	const client = postgres(adminUrl, { max: 1 });
	try {
		const rows = await client<{ exists: boolean }[]>`
			select exists (select 1 from pg_database where datname = ${targetDatabase}) as exists
		`;
		if (rows[0]?.exists !== true) {
			if (!/^[A-Za-z0-9_]+$/.test(targetDatabase)) {
				throw new Error(`Unsafe database name: ${targetDatabase}`);
			}
			await client.unsafe(`create database ${targetDatabase} owner app`);
			process.stdout.write(`[test:db] created database ${targetDatabase}\n`);
		} else {
			process.stdout.write(
				`[test:db] database ${targetDatabase} already exists\n`,
			);
		}
	} finally {
		await client.end({ timeout: 5 });
	}
}

async function dropDatabase(): Promise<void> {
	const { default: postgres } = await import("postgres");
	const client = postgres(adminUrl, { max: 1 });
	try {
		if (!/^[A-Za-z0-9_]+$/.test(targetDatabase)) {
		throw new Error(`Unsafe database name: ${targetDatabase}`);
	}
	await client.unsafe(
		`drop database if exists ${targetDatabase} with (force)`,
	);
		process.stdout.write(`[test:db] dropped database ${targetDatabase}\n`);
	} finally {
		await client.end({ timeout: 5 });
	}
}

async function main(): Promise<void> {
	await ensureDatabaseExists();

	const setupStatus = run("bun", ["run", "db:setup"]);
	if (setupStatus !== 0) {
		process.exit(setupStatus);
	}

	const testStatus = run("bun", ["test"]);
	if (testStatus !== 0) {
		if (shouldDrop) await dropDatabase();
		process.exit(testStatus);
	}

	if (shouldDrop) await dropDatabase();
	process.stdout.write("[test:db] done\n");
}

await main().catch((error) => {
	process.stderr.write(`[test:db] ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
