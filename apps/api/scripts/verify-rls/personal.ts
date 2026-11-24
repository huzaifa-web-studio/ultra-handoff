/**
 * Personal data RLS checks.
 *
 * Why this file: link previews are workspace data, while notifications and push
 * subscriptions are personal rows with their own policies. Keeping them
 * together makes the difference visible.
 *
 * Used by: `verify-rls.ts`.
 */

import { sql } from "drizzle-orm";
import { adminDb } from "../../src/db";
import { withTenant, withUser } from "../../src/db/tenant";

import { check, expectFailure } from "./shared";
import { INSUFFICIENT_PRIVILEGE, orgA, orgB, scopeA, suffix, userA, userB } from "./shared";

export async function checkPersonalBoundary(): Promise<void> {
		// 4g. Link previews follow the same boundary.
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

		// 4g. A notification belongs to one recipient, not the whole workspace.
		const notificationA = `rls-notification-a-${suffix}`;
		const notificationB = `rls-notification-b-${suffix}`;

		await adminDb.execute(sql`
			insert into "notification"
				(id, organization_id, recipient_user_id, type, dedupe_key)
			values
				(${notificationA}, ${orgA}, ${userA}, 'mention', ${`dedupe-a-${suffix}`}),
				(${notificationB}, ${orgA}, ${userB}, 'mention', ${`dedupe-b-${suffix}`})
		`);

		await check("notifications are scoped to the recipient", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute<{ id: string; recipient_user_id: string }>(
					sql`select id, recipient_user_id from "notification"
						where id in (${notificationA}, ${notificationB})`,
				),
			);

			if (rows.length !== 1) {
				throw new Error(`expected 1 row, got ${rows.length}`);
			}
			if (rows[0]?.id !== notificationA) {
				throw new Error("returned another user's notification");
			}
			return "1 row, own recipient only";
		});

		await check("a foreign notification update affects nothing", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute(
					sql`update "notification" set read_at = now() where id = ${notificationB}`,
				),
			);

			if (rows.count !== 0) throw new Error(`${rows.count} rows updated`);
			return "0 rows updated";
		});

		await check("a foreign notification delete affects nothing", async () => {
			const rows = await withTenant(scopeA, async (tx) =>
				tx.execute(sql`delete from "notification" where id = ${notificationB}`),
			);

			if (rows.count !== 0) throw new Error(`${rows.count} rows deleted`);
			return "0 rows deleted";
		});

		await check(
			"a notification insert can return the row under the recipient scope",
			async () => {
				const id = `rls-notification-insert-${suffix}`;

				const inserted = await withTenant(scopeA, async (tx) => {
					// The writer switches to the recipient for the insert, which
					// is what makes RETURNING pass the recipient SELECT policy.
					await tx.execute(
						sql`select set_config('app.current_user_id', ${userB}, true)`,
					);

					const rows = await tx.execute<{ id: string }>(sql`
						insert into "notification"
							(id, organization_id, recipient_user_id, type, dedupe_key)
						values (${id}, ${orgA}, ${userB}, 'mention', ${`dedupe-insert-${suffix}`})
						returning id
					`);

					await tx.execute(
						sql`select set_config('app.current_user_id', ${userA}, true)`,
					);

					return rows;
				});

				if (inserted.length !== 1 || inserted[0]?.id !== id) {
					throw new Error("returning did not echo the inserted row");
				}

				await adminDb.execute(sql`delete from "notification" where id = ${id}`);

				return "insert and returning work under the recipient scope";
			},
		);

		await expectFailure(
			"notification insert into another tenant is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withTenant(scopeA, async (tx) =>
					tx.execute(sql`
						insert into "notification"
							(id, organization_id, recipient_user_id, type, dedupe_key)
						values (${`rls-notification-intruder-${suffix}`}, ${orgB}, ${userB}, 'mention', ${`dedupe-intruder-${suffix}`})
					`),
				),
		);

		// 4h. Push subscriptions are personal device tokens, isolated by user.
		const pushA = `rls-push-a-${suffix}`;
		const pushB = `rls-push-b-${suffix}`;

		await adminDb.execute(sql`
			insert into "push_subscription" (id, user_id, endpoint, p256dh, auth)
			values
				(${pushA}, ${userA}, ${`https://push.example/${suffix}-a`}, 'key-a', 'auth-a'),
				(${pushB}, ${userB}, ${`https://push.example/${suffix}-b`}, 'key-b', 'auth-b')
		`);

		await check("push subscriptions are scoped to the user", async () => {
			const rows = await withUser(userA, async (tx) =>
				tx.execute<{ id: string }>(
					sql`select id from "push_subscription" where id in (${pushA}, ${pushB})`,
				),
			);

			if (rows.length !== 1 || rows[0]?.id !== pushA) {
				throw new Error(`unexpected rows: ${rows.map((row) => row.id).join(", ")}`);
			}

			return "1 row, own subscription only";
		});

		await expectFailure(
			"push subscription insert for another user is rejected",
			INSUFFICIENT_PRIVILEGE,
			async () =>
				withUser(userA, async (tx) =>
					tx.execute(sql`
						insert into "push_subscription" (id, user_id, endpoint, p256dh, auth)
						values (${`rls-push-intruder-${suffix}`}, ${userB}, ${`https://push.example/${suffix}-intruder`}, 'key', 'auth')
					`),
				),
		);

		await check(
			"a browser can claim its own endpoint from a previous account",
			async () => {
				const endpoint = `https://push.example/${suffix}-b`;

				await withUser(userA, async (tx) => {
					await tx.execute(
						sql`select set_config('app.push_endpoint', ${endpoint}, true)`,
					);
					await tx.execute(sql`
						update "push_subscription"
						set user_id = ${userA}
						where endpoint = ${endpoint}
					`);
				});

				const [row] = await adminDb.execute<{ user_id: string }>(
					sql`select user_id from "push_subscription" where endpoint = ${endpoint}`,
				);

				// Put the fixture back for the cascade check below.
				await adminDb.execute(sql`
					update "push_subscription" set user_id = ${userB}
					where endpoint = ${endpoint}
				`);

				if (row?.user_id !== userA) {
					throw new Error(`endpoint still owned by ${row?.user_id}`);
				}

				return "endpoint reassigned to the current browser account";
			},
		);

}
