/**
 * RLS verification fixtures.
 *
 * Why this file: the script seeds its own organization, users, members and
 * business rows on the privileged client, then removes everything it created.
 * The seed and cleanup stay together so the database is left as it was found.
 *
 * Used by: `verify-rls.ts`.
 */

import { adminDb } from "../../src/db";
import { APP_ROLE, changeRequestA, commentA, describeError, linkPreviewA, memberA, memberB, milestoneA, milestoneB, orgA, orgB, projectA, projectB, scopeEntryA, statusPeriodA, suffix, userA, userB } from "./shared";
import { sql } from "drizzle-orm";

/**
 * The role is created by scripts/bootstrap-db.ts. Fail early with a useful
 * message instead of a confusing "permission denied" later.
 */
export async function assertRoleExists(): Promise<void> {
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
export async function seed(): Promise<void> {
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
		insert into "change_request"
			(id, organization_id, project_id, milestone_id, title, status)
		values
			(${changeRequestA}, ${orgA}, ${projectA}, ${milestoneA}, ${"RLS Change Request"}, 'open')
	`);
	await adminDb.execute(sql`
		insert into "milestone_status_period"
			(id, organization_id, project_id, milestone_id, status)
		values
			(${statusPeriodA}, ${orgA}, ${projectA}, ${milestoneA}, 'in_testing')
	`);
	await adminDb.execute(sql`
		insert into "milestone_scope_entry"
			(id, organization_id, project_id, milestone_id, kind, round, title, status_period_id)
		values
			(${scopeEntryA}, ${orgA}, ${projectA}, ${milestoneA}, 'test', 1, ${"Test round 1"}, ${statusPeriodA})
	`);
	await adminDb.execute(sql`
		insert into "link_preview" (id, organization_id, url, url_hash)
		values
			(${linkPreviewA}, ${orgA}, ${"https://example.test"}, ${`hash-${suffix}`})
	`);
}

/** Remove every seeded row. Organization deletion cascades to projects. */
export async function cleanup(): Promise<void> {
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
