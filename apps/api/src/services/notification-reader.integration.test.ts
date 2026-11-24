/**
 * Notification list, paging and read state checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `notification-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { adminDb } from "../db";
import { notification } from "../db/schema";

import {
	cleanupNotificationFixture,
	clearNotifications,
	ids,
	rowsFor,
	seedNotificationFixture,
	suite,
	tDev,
	tOwner,
	tOwnerB,
} from "./notification-fixtures";
import {
	getNotificationSummary,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
} from "./notification-query";

suite("notification reader", () => {
	beforeAll(seedNotificationFixture);
	afterAll(cleanupNotificationFixture);

	describe("reader", () => {
		test("newest first with a stable order for identical timestamps", async () => {
			await clearNotifications();

			const at = new Date("2026-06-01T10:00:00.500Z");
			const idsInOrder = ["b-second", "a-first", "c-third"];

			await adminDb.insert(notification).values(
				idsInOrder.map((id) => ({
					id,
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: `order-${id}`,
					projectId: ids.pMain,
					createdAt: at,
					updatedAt: at,
				})),
			);

			const page = await listNotifications(tDev(), {
				cursor: null,
				limit: 10,
				filter: "all",
			});

			expect(page.notifications.map((row) => row.id)).toEqual([
				"c-third",
				"b-second",
				"a-first",
			]);
		});

		test("pagination walks every row exactly once", async () => {
			await clearNotifications();

			const at = new Date("2026-06-02T10:00:00Z");
			// Real notification ids are UUIDs, and the cursor validates that
			// shape, so the fixtures use UUIDs too.
			const pageIds = Array.from({ length: 5 }, () => randomUUID());

			await adminDb.insert(notification).values(
				pageIds.map((id) => ({
					id,
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: `page-${id}`,
					projectId: ids.pMain,
					createdAt: at,
					updatedAt: at,
				})),
			);

			const seen: string[] = [];
			let cursor: string | null = null;

			for (let index = 0; index < 5; index += 1) {
				const page = await listNotifications(tDev(), {
					cursor,
					limit: 2,
					filter: "all",
				});

				seen.push(...page.notifications.map((row) => row.id));
				cursor = page.nextCursor;

				if (!cursor) break;
			}

			expect(seen.length).toBe(5);
			expect(new Set(seen).size).toBe(5);
			expect(new Set(seen)).toEqual(new Set(pageIds));
		});

		test("a cursor whose row was deleted still returns the next page", async () => {
			await clearNotifications();

			const relative = randomUUID();
			const older = randomUUID();

			await adminDb.insert(notification).values([
				{
					id: relative,
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "gone-1",
					projectId: ids.pMain,
					createdAt: new Date("2026-06-03T10:00:00Z"),
				},
				{
					id: older,
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "gone-2",
					projectId: ids.pMain,
					createdAt: new Date("2026-06-03T09:00:00Z"),
				},
			]);

			const first = await listNotifications(tDev(), {
				cursor: null,
				limit: 1,
				filter: "all",
			});

			expect(first.notifications.map((row) => row.id)).toEqual([relative]);
			expect(first.nextCursor).not.toBeNull();

			// Delete the row the cursor points at. The position is self
			// contained, so the next page does not depend on that row existing.
			await adminDb.execute(
				sql`delete from "notification" where id = ${relative}`,
			);

			const second = await listNotifications(tDev(), {
				cursor: first.nextCursor,
				limit: 10,
				filter: "all",
			});

			expect(second.notifications.map((row) => row.id)).toEqual([older]);
		});

		test("a malformed cursor is rejected", async () => {
			await clearNotifications();

			await adminDb.insert(notification).values({
				id: randomUUID(),
				organizationId: ids.orgA,
				recipientUserId: ids.dev,
				type: "mention" as const,
				dedupeKey: "garbage-1",
				projectId: ids.pMain,
			});

			const encodeRaw = (value: string) =>
				Buffer.from(value, "utf8").toString("base64url");

			const cursors = [
				"not-a-real-cursor",
				encodeRaw("plain text"),
				encodeRaw(JSON.stringify({ t: "not a timestamp", i: randomUUID() })),
				encodeRaw(
					JSON.stringify({ t: "2026-06-03 10:00:00", i: "not-a-uuid" }),
				),
				encodeRaw(JSON.stringify({ t: "2026-06-03 10:00:00" })),
				encodeRaw(JSON.stringify([1, 2, 3])),
			];

			for (const cursor of cursors) {
				await expect(
					listNotifications(tDev(), { cursor, limit: 10, filter: "all" }),
				).rejects.toThrow("page link is no longer valid");
			}
		});

		test("unread filter returns only unread rows and the same unread count", async () => {
			await clearNotifications();

			await adminDb.insert(notification).values([
				{
					id: "u1",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "u-1",
					projectId: ids.pMain,
				},
				{
					id: "u2",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "u-2",
					projectId: ids.pMain,
					readAt: new Date(),
				},
			]);

			const page = await listNotifications(tDev(), {
				cursor: null,
				limit: 10,
				filter: "unread",
			});

			expect(page.notifications.map((row) => row.id)).toEqual(["u1"]);
			expect(page.unread).toBe(1);
		});

		test("summary groups unread by project and matches the list", async () => {
			await clearNotifications();

			await adminDb.insert(notification).values([
				{
					id: "s1",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "s-1",
					projectId: ids.pMain,
				},
				{
					id: "s2",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "s-2",
					projectId: ids.pMain,
				},
				{
					id: "s3",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "org_role_changed" as const,
					dedupeKey: "s-3",
				},
			]);

			const summary = await getNotificationSummary(tDev());

			expect(summary.unread).toBe(3);
			expect(summary.byProject).toEqual([{ projectId: ids.pMain, unread: 2 }]);
		});

		test("mark read is idempotent and never touches another recipient", async () => {
			await clearNotifications();

			await adminDb.insert(notification).values([
				{
					id: "r1",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "r-1",
					projectId: ids.pMain,
				},
				{
					id: "r2",
					organizationId: ids.orgA,
					recipientUserId: ids.client,
					type: "mention" as const,
					dedupeKey: "r-2",
					projectId: ids.pMain,
				},
			]);

			const first = await markNotificationRead(tDev(), "r1");
			expect(first.updated).toBe(1);
			expect(first.unread).toBe(0);

			const second = await markNotificationRead(tDev(), "r1");
			expect(second.updated).toBe(0);

			const foreign = await markNotificationRead(tDev(), "r2");
			expect(foreign.updated).toBe(0);

			const [clientRow] = await rowsFor(ids.client);
			expect(clientRow?.readAt).toBeNull();
		});

		test("read-all cutoff is inclusive at millisecond precision", async () => {
			await clearNotifications();

			const cutoff = new Date("2026-06-04T10:00:00.500Z");

			await adminDb.insert(notification).values([
				{
					id: "c-same",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "c-1",
					projectId: ids.pMain,
					createdAt: cutoff,
					updatedAt: cutoff,
				},
				{
					id: "c-later",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "c-2",
					projectId: ids.pMain,
					createdAt: new Date(cutoff.getTime() + 1),
					updatedAt: cutoff,
				},
			]);

			const result = await markAllNotificationsRead(tDev(), cutoff);

			expect(result.updated).toBe(1);
			expect(result.unread).toBe(1);

			const remaining = await listNotifications(tDev(), {
				cursor: null,
				limit: 10,
				filter: "unread",
			});

			expect(remaining.notifications.map((row) => row.id)).toEqual(["c-later"]);
		});

		test("a notification about an archived project is hidden from a plain member", async () => {
			await clearNotifications();

			await adminDb.insert(notification).values([
				{
					id: "vis-archived",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "project_archived" as const,
					dedupeKey: "vis-1",
					projectId: ids.pArchived,
				},
				{
					id: "vis-active",
					organizationId: ids.orgA,
					recipientUserId: ids.dev,
					type: "mention" as const,
					dedupeKey: "vis-2",
					projectId: ids.pMain,
				},
			]);

			const memberView = await listNotifications(tDev(), {
				cursor: null,
				limit: 10,
				filter: "all",
			});

			expect(memberView.notifications.map((row) => row.id)).toEqual([
				"vis-active",
			]);

			const ownerView = await listNotifications(tOwner(), {
				cursor: null,
				limit: 10,
				filter: "all",
			});

			expect(ownerView.notifications.length).toBe(0);

			// An org owner still sees archived projects.
			await adminDb
				.update(notification)
				.set({ recipientUserId: ids.owner })
				.where(eq(notification.id, "vis-archived"));

			const ownerAfter = await listNotifications(tOwner(), {
				cursor: null,
				limit: 10,
				filter: "all",
			});

			expect(ownerAfter.notifications.map((row) => row.id)).toEqual([
				"vis-archived",
			]);
		});

		test("a notification for another workspace is invisible", async () => {
			await clearNotifications();

			await adminDb.insert(notification).values({
				id: "cross-org",
				organizationId: ids.orgA,
				recipientUserId: ids.dev,
				type: "mention" as const,
				dedupeKey: "cross-1",
				projectId: ids.pMain,
			});

			const page = await listNotifications(tOwnerB(), {
				cursor: null,
				limit: 10,
				filter: "all",
			});

			expect(page.notifications.length).toBe(0);
			expect(page.unread).toBe(0);
		});
	});
});
