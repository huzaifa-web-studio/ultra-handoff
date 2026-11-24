/**
 * Notification write and fan-out checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `notification-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { adminDb } from "../db";
import { comment } from "../db/schema";
import { withTenant } from "../db/tenant";

import { createNotifications } from "./notification.service";
import {
	cleanupNotificationFixture,
	clearNotifications,
	ids,
	orgSlugA,
	paragraph,
	rowsFor,
	seedNotificationFixture,
	slugOf,
	suite,
} from "./notification-fixtures";

suite("notification writer", () => {
	beforeAll(seedNotificationFixture);
	afterAll(cleanupNotificationFixture);

	describe("writer", () => {
		test("one row per recipient, actor excluded, in-call duplicates collapsed", async () => {
			await clearNotifications();

			const deliveries = await withTenant(
				{ organizationId: ids.orgA, userId: ids.owner },
				(tx) =>
					createNotifications(
						tx,
						{ organizationId: ids.orgA, slug: orgSlugA },
						[
							{
								recipientUserId: ids.dev,
								actorUserId: ids.owner,
								type: "mention",
								dedupeKey: "w-1",
								project: { id: ids.pMain, name: "Main", slug: slugOf("main") },
								milestone: { id: ids.mMain, title: "Main milestone" },
							},
							{
								recipientUserId: ids.dev,
								actorUserId: ids.owner,
								type: "mention",
								dedupeKey: "w-1",
								project: { id: ids.pMain, name: "Main", slug: slugOf("main") },
								milestone: { id: ids.mMain, title: "Main milestone" },
							},
							{
								recipientUserId: ids.owner,
								actorUserId: ids.owner,
								type: "mention",
								dedupeKey: "w-2",
							},
							{
								recipientUserId: "",
								actorUserId: ids.owner,
								type: "mention",
								dedupeKey: "w-3",
							},
						],
					),
			);

			expect(deliveries.length).toBe(1);
			expect(deliveries[0]?.recipientUserId).toBe(ids.dev);
			expect(deliveries[0]?.title).toBe("New mention");

			const rows = await rowsFor(ids.dev);
			expect(rows.length).toBe(1);
		});

		test("a repeated writer call with the same dedupe key inserts nothing", async () => {
			const before = (await rowsFor(ids.dev)).length;

			const deliveries = await withTenant(
				{ organizationId: ids.orgA, userId: ids.owner },
				(tx) =>
					createNotifications(
						tx,
						{ organizationId: ids.orgA, slug: orgSlugA },
						[
							{
								recipientUserId: ids.dev,
								actorUserId: ids.owner,
								type: "mention",
								dedupeKey: "w-1",
								project: { id: ids.pMain, name: "Main", slug: slugOf("main") },
								milestone: { id: ids.mMain, title: "Main milestone" },
							},
						],
					),
			);

			expect(deliveries).toEqual([]);
			expect((await rowsFor(ids.dev)).length).toBe(before);
		});

		test("notification copy is rendered once and returned with the delivery", async () => {
			await clearNotifications();

			await adminDb.insert(comment).values({
				id: "w-copy-reply",
				organizationId: ids.orgA,
				milestoneId: ids.mMain,
				parentId: null,
				authorId: ids.owner,
				body: paragraph("root"),
				bodyText: "root",
			});

			const [delivery] = await withTenant(
				{ organizationId: ids.orgA, userId: ids.owner },
				(tx) =>
					createNotifications(
						tx,
						{ organizationId: ids.orgA, slug: orgSlugA },
						[
							{
								recipientUserId: ids.dev,
								actorUserId: ids.owner,
								type: "comment_reply",
								dedupeKey: "w-copy",
								project: { id: ids.pMain, name: "Main", slug: slugOf("main") },
								milestone: { id: ids.mMain, title: "Main milestone" },
								comment: {
									id: "w-copy-reply",
									parentId: null,
									preview: "Looks good",
								},
							},
						],
					),
			);

			expect(delivery?.title).toBe("New reply");
			expect(delivery?.body).toBe(
				'Owner A replied to your comment on Main milestone. "Looks good"',
			);
			expect(delivery?.href).toContain("milestoneTab=comment%3Aw-copy-reply");
			expect(delivery?.createdAt).toMatch(/Z$/);
		});
	});

	describe("fan-out cap", () => {
		test("501 candidates insert 500 rows and do not throw", async () => {
			await clearNotifications();

			const candidates = Array.from({ length: 501 }, (_, index) => ({
				recipientUserId: ids.dev,
				actorUserId: ids.owner,
				type: "mention" as const,
				dedupeKey: `cap-${index}`,
			}));

			const deliveries = await withTenant(
				{ organizationId: ids.orgA, userId: ids.owner },
				(tx) =>
					createNotifications(
						tx,
						{ organizationId: ids.orgA, slug: orgSlugA },
						candidates,
					),
			);

			expect(deliveries.length).toBe(500);

			const rows = await adminDb.execute<{ count: number }>(
				sql`select count(*)::int as count from "notification"
					where organization_id = ${ids.orgA}
						and recipient_user_id = ${ids.dev}`,
			);
			expect(rows[0]?.count ?? 0).toBe(500);
		});
	});
});
