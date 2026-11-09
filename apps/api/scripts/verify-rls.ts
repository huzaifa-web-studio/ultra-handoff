/**
 * Row level security checks against the real business tables.
 *
 * Why: RLS is invisible when it works and catastrophic when it silently does
 * not (for example if the tenant client ever fell back to the superuser). The
 * earlier version of this script used a throwaway probe table because no
 * business table existed. Now it exercises `project` and `project_member`
 * directly, including the cascade that removes project data with an
 * organization.
 *
 * The script seeds its own organization, user, member and project rows on the
 * privileged client, proves the tenant boundary, then removes everything it
 * created. Run against a development database only.
 *
 * Requires: `bun run db:bootstrap` and `bun run db:migrate`.
 * Used by: `bun run db:verify-rls`.
 */

import { sql } from "drizzle-orm";
import { adminClient, adminDb } from "../src/db";
import { closeTenantDb, getTenantDb, withTenant } from "../src/db/tenant";
import { TENANT_TABLES } from "./tenant-tables";

/** Postgres SQLSTATE for permission denied and RLS violations. */
const INSUFFICIENT_PRIVILEGE = "42501";
const APP_ROLE = "app_tenant";

type CheckResult = {
	name: string;
	passed: boolean;
	detail: string;
};

const results: CheckResult[] = [];
const suffix = Date.now().toString(36);

const orgA = `rls-org-a-${suffix}`;
const orgB = `rls-org-b-${suffix}`;
const userA = `rls-user-a-${suffix}`;
const userB = `rls-user-b-${suffix}`;
const memberA = `rls-member-a-${suffix}`;
const memberB = `rls-member-b-${suffix}`;
const projectA = `rls-project-a-${suffix}`;
const projectB = `rls-project-b-${suffix}`;
const milestoneA = `rls-milestone-a-${suffix}`;
const milestoneB = `rls-milestone-b-${suffix}`;
const commentA = `rls-comment-a-${suffix}`;
const linkPreviewA = `rls-link-preview-a-${suffix}`;

const scopeA = { organizationId: orgA, userId: userA };

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function pgErrorCode(error: unknown): string | undefined {
	// Drizzle wraps driver failures in a DrizzleQueryError, so the Postgres
	// SQLSTATE sits on the cause chain rather than on the top level error.
	let current: unknown = error;

	for (let depth = 0; depth < 5; depth += 1) {
		if (typeof current !== "object" || current === null) return undefined;

		const code = (current as { code?: unknown }).code;
		if (typeof code === "string") return code;

		current = (current as { cause?: unknown }).cause;
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
 * Seed two workspaces with one project each.
 *
 * Everything is created on the privileged client because these are auth tables
 * and the tenant role has no access to them. `created_by` is left null, which
 * is the same state a project reaches after its creator deletes their account.
 */
async function seed(): Promise<void> {
	// Raw SQL through postgres-js expects a string here, not a Date. The
	// timestamp column accepts an ISO string and casts it.
	const now = new Date().toISOString();

	await adminDb.execute(sql`
		insert into "organization" (id, name, slug, created_at)
		values
			(${orgA}, ${"RLS Org A"}, ${`rls-a-${suffix}`}, ${now}),
			(${orgB}, ${"RLS Org B"}, ${`rls-b-${suffix}`}, ${now})
	`);
	await adminDb.execute(sql`
		insert into "user" (id, name, email, email_verified, created_at, updated_at)
		values
			(${userA}, ${"RLS User A"}, ${`rls-a-${suffix}@example.test`}, false, ${now}, ${now}),
			(${userB}, ${"RLS User B"}, ${`rls-b-${suffix}@example.test`}, false, ${now}, ${now})
	`);
	await adminDb.execute(sql`
		insert into "member" (id, organization_id, user_id, role, created_at)
		values
			(${memberA}, ${orgA}, ${userA}, 'owner', ${now}),
			(${memberB}, ${orgB}, ${userB}, 'owner', ${now})
	`);
	await adminDb.execute(sql`
		insert into "project" (id, organization_id, name, slug)
		values
			(${projectA}, ${orgA}, ${"RLS Project A"}, ${`rls-project-a-${suffix}`}),
			(${projectB}, ${orgB}, ${"RLS Project B"}, ${`rls-project-b-${suffix}`})
	`);
	await adminDb.execute(sql`
		insert into "project_member" (id, organization_id, project_id, member_id, user_id, role)
		values
			(${`rls-pm-a-${suffix}`}, ${orgA}, ${projectA}, ${memberA}, ${userA}, 'owner'),
			(${`rls-pm-b-${suffix}`}, ${orgB}, ${projectB}, ${memberB}, ${userB}, 'owner')
	`);
	await adminDb.execute(sql`
		insert into "project_pin" (id, organization_id, project_id, user_id, pinned_at)
		values
			(${`rls-pa-a-${suffix}`}, ${orgA}, ${projectA}, ${userA}, ${now})
	`);
	await adminDb.execute(sql`
		insert into "milestone" (id, organization_id, project_id, title)
		values
			(${milestoneA}, ${orgA}, ${projectA}, ${"RLS Milestone A"}),
			(${milestoneB}, ${orgB}, ${projectB}, ${"RLS Milestone B"})
	`);
	await adminDb.execute(sql`
		insert into "milestone_assignee" (id, organization_id, milestone_id, project_member_id)
		values
			(${`rls-ma-a-${suffix}`}, ${orgA}, ${milestoneA}, ${`rls-pm-a-${suffix}`})
	`);
	await adminDb.execute(sql`
		insert into "comment" (id, organization_id, milestone_id, body, body_text)
		values
			(${commentA}, ${orgA}, ${milestoneA}, ${"[]"}::jsonb, ${""})
	`);
	await adminDb.execute(sql`
		insert into "link_preview" (id, organization_id, url, url_hash)
		values
			(${linkPreviewA}, ${orgA}, ${"https://example.test"}, ${`hash-${suffix}`})
	`);
}

/** Remove every seeded row. Organization deletion cascades to projects. */
async function cleanup(): Promise<void> {
	try {
		await adminDb.execute(
			sql`delete from "organization" where id in (${orgA}, ${orgB})`,
		);
		await adminDb.execute(
			sql`delete from "user" where id in (${userA}, ${userB})`,
		);
	} catch (error) {
		process.stdout.write(`[cleanup] ${describeError(error)}\n`);
	}
}

async function main(): Promise<void> {
	await assertRoleExists();
	await seed();

	try {
		// 1. Without a scope the tenant role learns nothing.
		await check("unscoped project read returns no rows", async () => {
			const rows = await getTenantDb().execute<{ id: string }>(
				sql`select id from "project"`,
			);
			if (rows.length !== 0) {
				throw new Error(`expected 0 rows, got ${rows.length}`);
			}
			return "0 rows";
		});

		// 2. With a scope, only that tenant is visible.
		await check("scoped project read only sees its own tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ id: string; organization_id: string }>(
					sql`select id, organization_id from "project"`,
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
					sql`select id from "project" where organization_id = ${orgB}`,
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
						sql`insert into "project" (id, organization_id, name, slug)
							values (${`rls-intruder-${suffix}`}, ${orgB}, ${"Intruder"}, ${`intruder-${suffix}`})`,
					),
				),
		);

		await check("update of a foreign project affects nothing", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ id: string }>(
					sql`update "project" set name = ${"Hijacked"}
						where id = ${projectB} returning id`,
				),
			);
			if (rows.length !== 0) {
				throw new Error(`expected 0 updated rows, got ${rows.length}`);
			}
			return "0 rows updated";
		});

		await check("delete of a foreign project affects nothing", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ id: string }>(
					sql`delete from "project" where id = ${projectB} returning id`,
				),
			);
			if (rows.length !== 0) {
				throw new Error(`expected 0 deleted rows, got ${rows.length}`);
			}
			return "0 rows deleted";
		});

		// 4. The membership table follows the same rules.
		await check("project members are scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "project_member"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a membership from another tenant");
			}
			return "1 row, own tenant only";
		});

		await expectFailure(
			"project member insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "project_member"
							(id, organization_id, project_id, member_id, user_id, role)
							values (${`rls-pm-intruder-${suffix}`}, ${orgB}, ${projectB}, ${memberB}, ${userB}, ${"member"})`,
					),
				),
		);

		// 4b. Per user project pins follow the same boundary.
		await check("project pin is scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "project_pin"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a pin from another tenant");
			}
			return "1 row, own tenant only";
		});

		await expectFailure(
			"project pin insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "project_pin"
							(id, organization_id, project_id, user_id)
							values (${`rls-pa-intruder-${suffix}`}, ${orgB}, ${projectB}, ${userB})`,
					),
				),
		);

		// 4c. Milestones and their assignments follow the same boundary.
		await check("milestones are scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "milestone"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a milestone from another tenant");
			}
			return "1 row, own tenant only";
		});

		await check("milestone assignments are scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "milestone_assignee"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned an assignment from another tenant");
			}
			return "1 row, own tenant only";
		});

		await expectFailure(
			"milestone insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "milestone" (id, organization_id, project_id, title)
							values (${`rls-milestone-intruder-${suffix}`}, ${orgB}, ${projectB}, ${"Intruder"})`,
					),
				),
		);

		await expectFailure(
			"milestone assignment insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "milestone_assignee"
							(id, organization_id, milestone_id, project_member_id)
							values (${`rls-ma-intruder-${suffix}`}, ${orgB}, ${milestoneB}, ${`rls-pm-b-${suffix}`})`,
					),
				),
		);

		// 4d. Comments follow the same boundary.
		await check("comments are scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "comment"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a comment from another tenant");
			}
			return "1 row, own tenant only";
		});

		await expectFailure(
			"comment insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "comment" (id, organization_id, milestone_id, body, body_text)
							values (${`rls-comment-intruder-${suffix}`}, ${orgB}, ${milestoneB}, ${"[]"}::jsonb, ${""})`,
					),
				),
		);

		// 4e. Link previews follow the same boundary.
		await check("link previews are scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "link_preview"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a link preview from another tenant");
			}
			return "1 row, own tenant only";
		});

		await expectFailure(
			"link preview insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "link_preview" (id, organization_id, url, url_hash)
							values (${`rls-link-preview-intruder-${suffix}`}, ${orgB}, ${"https://example.test"}, ${`hash-intruder-${suffix}`})`,
					),
				),
		);

		// 4f. The allowlist and the RLS policies must agree in both directions.
		await check("tenant tables match rls policies", async () => {
			const rows = await adminDb.execute<{ relname: string }>(sql`
				select c.relname
				from pg_class c
				join pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'public'
					and c.relkind = 'r'
					and c.relrowsecurity = true
				order by c.relname
			`);
			const withPolicy = new Set(rows.map((row) => row.relname));
			const listed = new Set(TENANT_TABLES);
			const missingPolicy = [...listed].filter(
				(name) => !withPolicy.has(name),
			);
			const missingGrant = [...withPolicy].filter(
				(name) => !listed.has(name),
			);
			if (missingPolicy.length > 0 || missingGrant.length > 0) {
				throw new Error(
					`listed but no policy: ${missingPolicy.join(", ") || "(none)"}; policy but not listed: ${missingGrant.join(", ") || "(none)"}`,
				);
			}
			return `${listed.size} tables`;
		});

		// 5. Better Auth tables are not granted at all.
		await expectFailure(
			"Better Auth user table is not readable",
			INSUFFICIENT_PRIVILEGE,
			async () => getTenantDb().execute(sql`select count(*) from "user"`),
		);

		// 6. Sanity: the privileged client is unaffected, so the auth API and
		//    migrations keep working.
		await check("privileged client still sees every project", async () => {
			const rows = await adminDb.execute<{ id: string }>(
				sql`select id from "project" where id in (${projectA}, ${projectB})`,
			);
			if (rows.length !== 2) {
				throw new Error(`expected 2 rows, got ${rows.length}`);
			}
			return "2 rows, RLS bypassed as designed";
		});

		// 7. The slug is unique per workspace, not globally.
		await check("the same slug is allowed in another workspace", async () => {
			const slug = `shared-${suffix}`;
			await adminDb.execute(sql`
				insert into "project" (id, organization_id, name, slug)
				values
					(${`rls-shared-a-${suffix}`}, ${orgA}, ${"Shared A"}, ${slug}),
					(${`rls-shared-b-${suffix}`}, ${orgB}, ${"Shared B"}, ${slug})
			`);
			return "2 rows inserted";
		});

		// 8. Deleting the organization cascades to its projects and members.
		await check("organization deletion cascades to project data", async () => {
			await adminDb.execute(sql`delete from "organization" where id = ${orgA}`);

			const projects = await adminDb.execute<{ id: string }>(
				sql`select id from "project" where organization_id = ${orgA}`,
			);
			const memberships = await adminDb.execute<{ id: string }>(
				sql`select id from "project_member" where organization_id = ${orgA}`,
			);
			const pins = await adminDb.execute<{ id: string }>(
				sql`select id from "project_pin" where organization_id = ${orgA}`,
			);
			const milestones = await adminDb.execute<{ id: string }>(
				sql`select id from "milestone" where organization_id = ${orgA}`,
			);
			const assignments = await adminDb.execute<{ id: string }>(
				sql`select id from "milestone_assignee" where organization_id = ${orgA}`,
			);
			const comments = await adminDb.execute<{ id: string }>(
				sql`select id from "comment" where organization_id = ${orgA}`,
			);
			const linkPreviews = await adminDb.execute<{ id: string }>(
				sql`select id from "link_preview" where organization_id = ${orgA}`,
			);

			if (
				projects.length !== 0 ||
				memberships.length !== 0 ||
				pins.length !== 0 ||
				milestones.length !== 0 ||
				assignments.length !== 0 ||
				comments.length !== 0 ||
				linkPreviews.length !== 0
			) {
				throw new Error(
					`expected 0 rows, got ${projects.length} projects, ${memberships.length} memberships, ${pins.length} pins, ${milestones.length} milestones, ${assignments.length} assignments, ${comments.length} comments and ${linkPreviews.length} link previews`,
				);
			}

			return "projects, memberships, pins, milestones, assignments, comments and link previews removed";
		});
	} finally {
		await cleanup();
		await closeTenantDb();
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
