/**
 * Allowlist, auth table and cascade checks.
 *
 * Why this file: the allowlist must agree with the policies, Better Auth tables
 * must stay ungranted, and an organization delete must cascade. These are the
 * remaining invariants after the tenant boundary is proved.
 *
 * Used by: `verify-rls.ts`.
 */

import { sql } from "drizzle-orm";
import { adminDb } from "../../src/db";
import { getTenantDb } from "../../src/db/tenant";

import { check, expectFailure } from "./shared";
import { INSUFFICIENT_PRIVILEGE, orgA, orgB, projectA, projectB, suffix } from "./shared";
import { TENANT_TABLES } from "../tenant-tables";

export async function checkMiscBoundary(): Promise<void> {
		// 4i. The allowlist and the RLS policies must agree in both directions.
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
			const changeRequests = await adminDb.execute<{ id: string }>(
				sql`select id from "change_request" where organization_id = ${orgA}`,
			);
			const statusPeriods = await adminDb.execute<{ id: string }>(
				sql`select id from "milestone_status_period" where organization_id = ${orgA}`,
			);
			const scopeEntries = await adminDb.execute<{ id: string }>(
				sql`select id from "milestone_scope_entry" where organization_id = ${orgA}`,
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
				changeRequests.length !== 0 ||
				statusPeriods.length !== 0 ||
				scopeEntries.length !== 0 ||
				linkPreviews.length !== 0
			) {
				throw new Error(
					`expected 0 rows, got ${projects.length} projects, ${memberships.length} memberships, ${pins.length} pins, ${milestones.length} milestones, ${assignments.length} assignments, ${comments.length} comments, ${changeRequests.length} change requests, ${statusPeriods.length} status periods, ${scopeEntries.length} scope entries and ${linkPreviews.length} link previews`,
				);
			}

			return "projects, memberships, pins, milestones, assignments, comments, change requests, status periods, scope entries and link previews removed";
		});
}
