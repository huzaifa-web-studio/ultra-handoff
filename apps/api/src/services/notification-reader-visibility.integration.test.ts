/**
 * Notification read-all visibility checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `notification-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { adminDb } from "../db";
import { notification, project } from "../db/schema";

import {
	cleanupNotificationFixture,
	clearNotifications,
	ids,
	rowsFor,
	seedNotificationFixture,
	suffix,
	suite,
	tClient,
	tDev,
} from "./notification-fixtures";
import { markAllNotificationsRead } from "./notification-query";

suite("notification reader visibility", () => {
	beforeAll(seedNotificationFixture);
	afterAll(cleanupNotificationFixture);

	describe("read-all visibility", () => {
		test("a hidden archived project row is not marked read", async () => {
			await clearNotifications();

			// An earlier test restores this project, so archive it again here.
			// dev holds the plain member project role, so the row is invisible.
			await adminDb
				.update(project)
				.set({ archivedAt: new Date() })
				.where(eq(project.id, ids.pArchived));

			await adminDb.insert(notification).values([
				{
					id: randomUUID(),
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					actorUserId: ids.owner,
					type: "mention",
					dedupeKey: `visible-${suffix}`,
					projectId: ids.pMain,
				},
				{
					id: randomUUID(),
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					actorUserId: ids.owner,
					type: "mention",
					dedupeKey: `hidden-${suffix}`,
					projectId: ids.pArchived,
				},
			]);

			const result = await markAllNotificationsRead(tDev(), new Date());

			expect(result.updated).toBe(1);

			const rows = await rowsFor(ids.dev);
			const visible = rows.find((row) => row.projectId === ids.pMain);
			const hidden = rows.find((row) => row.projectId === ids.pArchived);

			expect(visible?.readAt).not.toBeNull();
			expect(hidden?.readAt).toBeNull();

			// Leave the project as the rest of the suite expects it.
			await adminDb
				.update(project)
				.set({ archivedAt: null })
				.where(eq(project.id, ids.pArchived));
		});

		test("the cutoff is honoured at millisecond precision", async () => {
			await clearNotifications();

			await adminDb.insert(notification).values([
				{
					id: randomUUID(),
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					actorUserId: ids.owner,
					type: "mention",
					dedupeKey: `before-${suffix}`,
					createdAt: new Date("2026-11-23T08:00:00.100Z"),
				},
				{
					id: randomUUID(),
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					actorUserId: ids.owner,
					type: "mention",
					dedupeKey: `after-${suffix}`,
					createdAt: new Date("2026-11-23T08:00:00.102Z"),
				},
			]);

			const result = await markAllNotificationsRead(
				tDev(),
				new Date("2026-11-23T08:00:00.101Z"),
			);

			expect(result.updated).toBe(1);

			const rows = await rowsFor(ids.dev);
			const before = rows.find((row) => row.dedupeKey === `before-${suffix}`);
			const after = rows.find((row) => row.dedupeKey === `after-${suffix}`);

			expect(before?.readAt).not.toBeNull();
			expect(after?.readAt).toBeNull();
		});

		test("2,000 unread rows complete without a parameter limit error", async () => {
			await clearNotifications();

			const rows = Array.from({ length: 2000 }, (_, index) => ({
				id: randomUUID(),
				organizationId: ids.orgA,
				recipientUserId: ids.client,
				actorUserId: ids.owner,
				type: "mention" as const,
				dedupeKey: `bulk-${suffix}-${index}`,
			}));

			await adminDb.insert(notification).values(rows);

			const result = await markAllNotificationsRead(tClient(), new Date());

			expect(result.updated).toBe(2000);
			expect(result.unread).toBe(0);

			const left = await adminDb.execute<{ count: number }>(
				sql`select count(*)::int as count from "notification"
					where organization_id = ${ids.orgA}
						and recipient_user_id = ${ids.client}
						and read_at is null`,
			);
			expect(left[0]?.count ?? 0).toBe(0);
		});
	});
});
