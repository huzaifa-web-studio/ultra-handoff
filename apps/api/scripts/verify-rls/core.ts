/**
 * Core RLS boundary checks.
 *
 * Why this file: the unscoped read, the scoped read and the project, pin and
 * membership writes are the base proof that the tenant role is confined. They
 * run before the domain checks.
 *
 * Used by: `verify-rls.ts`.
 */

import { sql } from "drizzle-orm";
import { getTenantDb, withTenant } from "../../src/db/tenant";

import { check, expectFailure } from "./shared";
import { INSUFFICIENT_PRIVILEGE, memberB, orgA, orgB, projectB, scopeA, suffix, userB } from "./shared";

export async function checkCoreBoundary(): Promise<void> {
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

}
