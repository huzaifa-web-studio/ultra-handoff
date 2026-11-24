/**
 * Push subscription checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `notification-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { adminDb } from "../db";

import {
	cleanupNotificationFixture,
	ids,
	seedNotificationFixture,
	suffix,
	suite,
} from "./notification-fixtures";

suite("notification push", () => {
	beforeAll(seedNotificationFixture);
	afterAll(cleanupNotificationFixture);

	describe("push subscriptions", () => {
		test("a valid subscription is stored, refreshed and removed", async () => {
			const { savePushSubscription, removePushSubscription } = await import(
				"./push.service"
			);

			const endpoint = `https://push.example/${suffix}-one`;

			await savePushSubscription(ids.client, {
				endpoint,
				p256dh: "key-one",
				auth: "auth-one",
				userAgent: "qa-agent",
			});

			await savePushSubscription(ids.client, {
				endpoint,
				p256dh: "key-two",
				auth: "auth-two",
				userAgent: "qa-agent-2",
			});

			const rows = await adminDb.execute<{ p256dh: string; auth: string }>(
				sql`select p256dh, auth from "push_subscription" where user_id = ${ids.client} and endpoint = ${endpoint}`,
			);

			expect(rows.length).toBe(1);
			expect(rows[0]?.p256dh).toBe("key-two");
			expect(rows[0]?.auth).toBe("auth-two");

			await removePushSubscription(ids.client, endpoint);

			const after = await adminDb.execute<{ count: number }>(
				sql`select count(*)::int as count from "push_subscription" where user_id = ${ids.client} and endpoint = ${endpoint}`,
			);

			expect(after[0]?.count).toBe(0);
		});

		test("invalid endpoints and keys are rejected", async () => {
			const { savePushSubscription } = await import("./push.service");

			await expect(
				savePushSubscription(ids.client, {
					endpoint: "http://not-https.example/x",
					p256dh: "k",
					auth: "a",
				}),
			).rejects.toThrow();

			await expect(
				savePushSubscription(ids.client, {
					endpoint: "https://push.example/ok",
					p256dh: "",
					auth: "a",
				}),
			).rejects.toThrow();

			await expect(
				savePushSubscription(ids.client, {
					endpoint: 42,
					p256dh: "k",
					auth: "a",
				}),
			).rejects.toThrow();
		});

		test("the oldest device is pruned past ten subscriptions", async () => {
			const { savePushSubscription } = await import("./push.service");

			await adminDb.execute(
				sql`delete from "push_subscription" where user_id = ${ids.client}`,
			);

			const created: string[] = [];

			for (let index = 0; index < 11; index += 1) {
				const endpoint = `https://push.example/${suffix}-device-${index}`;
				created.push(endpoint);
				await savePushSubscription(ids.client, {
					endpoint,
					p256dh: `key-${index}`,
					auth: `auth-${index}`,
				});
			}

			const rows = await adminDb.execute<{ endpoint: string }>(
				sql`select endpoint from "push_subscription" where user_id = ${ids.client} order by created_at asc, endpoint asc`,
			);

			expect(rows.length).toBe(10);
			expect(rows.map((row) => row.endpoint)).not.toContain(created[0]);

			await adminDb.execute(
				sql`delete from "push_subscription" where user_id = ${ids.client}`,
			);
		});

		test("a browser endpoint is claimed from a previous account", async () => {
			const { savePushSubscription } = await import("./push.service");

			const endpoint = `https://push.example/${suffix}-claim`;

			await savePushSubscription(ids.client, {
				endpoint,
				p256dh: "key",
				auth: "auth",
			});

			await savePushSubscription(ids.dev, {
				endpoint,
				p256dh: "key-2",
				auth: "auth-2",
			});

			const rows = await adminDb.execute<{ user_id: string; p256dh: string }>(
				sql`select user_id, p256dh from "push_subscription" where endpoint = ${endpoint}`,
			);

			expect(rows.length).toBe(1);
			expect(rows[0]?.user_id).toBe(ids.dev);
			expect(rows[0]?.p256dh).toBe("key-2");

			await adminDb.execute(
				sql`delete from "push_subscription" where endpoint = ${endpoint}`,
			);
		});
	});
});
