/**
 * Domain RLS boundary checks.
 *
 * Why this file: milestones, comments, change requests, phase periods and scope
 * sections all hang off a project and must follow the same boundary.
 *
 * Used by: `verify-rls.ts`.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "../../src/db/tenant";

import { check, expectFailure } from "./shared";
import { INSUFFICIENT_PRIVILEGE, milestoneB, orgA, orgB, projectB, scopeA, suffix } from "./shared";

export async function checkDomainBoundary(): Promise<void> {
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

		// 4e. Change requests follow the same boundary.
		await check("change requests are scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "change_request"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a change request from another tenant");
			}
			return "1 row, own tenant only";
		});

		await expectFailure(
			"change request insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "change_request"
							(id, organization_id, project_id, milestone_id, title, status)
							values (${`rls-change-intruder-${suffix}`}, ${orgB}, ${projectB}, ${milestoneB}, ${"Intruder"}, 'open')`,
					),
				),
		);

		// 4f. Phase periods and scope sections follow the same boundary.
		await check("milestone status periods are scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "milestone_status_period"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a period from another tenant");
			}
			return "1 row, own tenant only";
		});

		await check("milestone scope entries are scoped to the tenant", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ organization_id: string }>(
					sql`select organization_id from "milestone_scope_entry"`,
				),
			);
			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.organization_id !== orgA) {
				throw new Error("returned a scope entry from another tenant");
			}
			return "1 row, own tenant only";
		});

		await expectFailure(
			"status period insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "milestone_status_period"
							(id, organization_id, project_id, milestone_id, status)
							values (${`rls-period-intruder-${suffix}`}, ${orgB}, ${projectB}, ${milestoneB}, 'todo')`,
					),
				),
		);

		await expectFailure(
			"scope entry insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(
						sql`insert into "milestone_scope_entry"
							(id, organization_id, project_id, milestone_id, kind, title)
							values (${`rls-scope-intruder-${suffix}`}, ${orgB}, ${projectB}, ${milestoneB}, 'change', ${"Intruder"})`,
					),
				),
		);

}
