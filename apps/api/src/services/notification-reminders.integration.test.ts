/**
 * Reminder sweep checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `notification-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { and, eq } from "drizzle-orm";

import { adminDb } from "../db";
import { user } from "../db/auth-schema";
import { milestone, milestoneAssignee, notification } from "../db/schema";
import { withTenant } from "../db/tenant";

import {
	assign,
	cleanupNotificationFixture,
	clearNotifications,
	countOrgNotifications,
	ids,
	orgSlugA,
	rowsFor,
	seedNotificationFixture,
	suite,
	tDev,
} from "./notification-fixtures";
import { listNotifications } from "./notification-query";
import { runReminderSweepForOrganization } from "./reminder.service";

suite("notification reminders", () => {
	beforeAll(seedNotificationFixture);
	afterAll(cleanupNotificationFixture);

	describe("reminder sweep", () => {
		const MAX_OVERDUE_DAYS = 21;

		async function sweep(now: Date) {
			return withTenant(
				{ organizationId: ids.orgA, userId: "system:reminder" },
				(tx) =>
					runReminderSweepForOrganization(
						tx,
						{ organizationId: ids.orgA, slug: orgSlugA },
						now,
					),
			);
		}

		test("no reminder before 09:00 local, then one after", async () => {
			await clearNotifications();
			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-11-24", status: "todo" })
				.where(eq(milestone.id, ids.mReminder));

			const early = await sweep(new Date("2026-11-23T08:00:00Z"));
			expect(early.length).toBe(0);
			expect((await rowsFor(ids.dev)).length).toBe(0);

			const onTime = await sweep(new Date("2026-11-23T10:00:00Z"));
			expect(onTime.length).toBe(1);

			const rows = await rowsFor(ids.dev);
			expect(rows[0]?.type).toBe("milestone_due_soon");
			expect(rows[0]?.data).toMatchObject({
				phase: "tomorrow",
				dueDate: "2026-11-24",
			});
			expect(onTime[0]?.body).toContain("is due tomorrow, 24 Nov 2026");
		});

		test("a repeated sweep does not duplicate the reminder", async () => {
			const before = (await rowsFor(ids.dev)).length;
			const again = await sweep(new Date("2026-11-23T10:30:00Z"));

			expect(again.length).toBe(0);
			expect((await rowsFor(ids.dev)).length).toBe(before);
		});

		test("the recipient's own timezone decides eligibility", async () => {
			await clearNotifications();
			await adminDb
				.update(user)
				.set({ timezone: "America/Los_Angeles" })
				.where(eq(user.id, ids.dev));

			// 14:00 UTC is 06:00 in Los Angeles.
			const laEarly = await sweep(new Date("2026-11-23T14:00:00Z"));
			expect(laEarly.length).toBe(0);

			await adminDb
				.update(user)
				.set({ timezone: "UTC" })
				.where(eq(user.id, ids.dev));

			const utcLater = await sweep(new Date("2026-11-23T14:00:00Z"));
			expect(utcLater.length).toBe(1);
		});

		test("a moved due date hides the stale unread reminder", async () => {
			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-11-26" })
				.where(eq(milestone.id, ids.mReminder));

			const page = await listNotifications(tDev(), {
				cursor: null,
				limit: 20,
				filter: "all",
			});

			expect(
				page.notifications.some((row) => row.type === "milestone_due_soon"),
			).toBe(false);

			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-11-24" })
				.where(eq(milestone.id, ids.mReminder));
		});

		test("a completed milestone hides its unread reminder", async () => {
			await clearNotifications();
			await adminDb
				.update(milestone)
				.set({ status: "todo" })
				.where(eq(milestone.id, ids.mReminder));

			await sweep(new Date("2026-11-23T10:00:00Z"));

			const before = await listNotifications(tDev(), {
				cursor: null,
				limit: 20,
				filter: "all",
			});
			expect(before.unread).toBe(1);

			await adminDb
				.update(milestone)
				.set({ status: "done" })
				.where(eq(milestone.id, ids.mReminder));

			const after = await listNotifications(tDev(), {
				cursor: null,
				limit: 20,
				filter: "all",
			});
			expect(after.unread).toBe(0);
			expect(after.notifications.length).toBe(0);
		});

		test("an overdue milestone fires on day 1 but not day 2", async () => {
			await clearNotifications();
			await adminDb
				.update(milestone)
				.set({ status: "todo", dueDate: "2026-11-22" })
				.where(eq(milestone.id, ids.mReminder));

			const day1 = await sweep(new Date("2026-11-23T10:00:00Z"));
			expect(day1.length).toBe(1);
			expect(day1[0]?.type).toBe("milestone_overdue");
			expect(day1[0]?.body).toContain("1 day overdue");

			await clearNotifications();
			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-11-21" })
				.where(eq(milestone.id, ids.mReminder));

			const day2 = await sweep(new Date("2026-11-23T10:00:00Z"));
			expect(day2.length).toBe(0);
		});

		test("an unmanaged milestone reminds the managers, not plain members", async () => {
			await clearNotifications();
			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-11-24", status: "todo" })
				.where(eq(milestone.id, ids.mMain));

			await adminDb
				.delete(milestoneAssignee)
				.where(eq(milestoneAssignee.milestoneId, ids.mMain));

			const deliveries = await sweep(new Date("2026-11-23T10:00:00Z"));
			const recipients = deliveries.map((row) => row.recipientUserId);

			expect(recipients).toContain(ids.owner);
			expect(recipients).not.toContain(ids.dev);
			expect(recipients).not.toContain(ids.client);

			await assign(ids.mMain, ids.pmDev);
		});

		test("a milestone outside the sweep window is ignored", async () => {
			await clearNotifications();
			await adminDb
				.update(milestone)
				.set({ dueDate: null })
				.where(eq(milestone.id, ids.mMain));
			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-12-31", status: "todo" })
				.where(eq(milestone.id, ids.mReminder));

			const deliveries = await sweep(new Date("2026-11-23T10:00:00Z"));
			expect(deliveries.length).toBe(0);

			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-11-24" })
				.where(eq(milestone.id, ids.mReminder));
		});

		test("the sweep never notifies a user who is not in the workspace", async () => {
			await clearNotifications();
			const before = await countOrgNotifications();
			await sweep(new Date("2026-11-23T10:00:00Z"));
			const after = await countOrgNotifications();

			// Only in-workspace recipients may gain rows.
			const rows = await adminDb
				.select({ recipient: notification.recipientUserId })
				.from(notification)
				.where(eq(notification.organizationId, ids.orgA));

			for (const row of rows) {
				expect([ids.owner, ids.dev, ids.client]).toContain(row.recipient);
			}

			expect(after).toBeGreaterThanOrEqual(before);
			expect(MAX_OVERDUE_DAYS).toBe(21);
		});

		test("the today reminder replaces the unread tomorrow row", async () => {
			await clearNotifications();
			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-11-24", status: "todo" })
				.where(eq(milestone.id, ids.mReminder));

			await sweep(new Date("2026-11-23T10:00:00Z"));
			const tomorrowRows = await rowsFor(ids.dev);
			expect(tomorrowRows.length).toBe(1);
			expect(tomorrowRows[0]?.data).toMatchObject({ phase: "tomorrow" });

			await sweep(new Date("2026-11-24T10:00:00Z"));

			const rows = await rowsFor(ids.dev);
			const dueSoon = rows.filter((row) => row.type === "milestone_due_soon");

			// One live reminder for the due date, not two.
			expect(dueSoon.length).toBe(1);
			expect(dueSoon[0]?.data).toMatchObject({
				phase: "today",
				dueDate: "2026-11-24",
			});
		});

		test("a tomorrow row that was already read stays as history", async () => {
			await clearNotifications();
			await adminDb
				.update(milestone)
				.set({ dueDate: "2026-11-24", status: "todo" })
				.where(eq(milestone.id, ids.mReminder));

			await sweep(new Date("2026-11-23T10:00:00Z"));

			// The recipient read it before the due date arrived.
			await adminDb
				.update(notification)
				.set({ readAt: new Date() })
				.where(
					and(
						eq(notification.organizationId, ids.orgA),
						eq(notification.recipientUserId, ids.dev),
					),
				);

			await sweep(new Date("2026-11-24T10:00:00Z"));

			const rows = await rowsFor(ids.dev);
			const dueSoon = rows.filter((row) => row.type === "milestone_due_soon");

			expect(dueSoon.length).toBe(2);
			const phases = dueSoon.map((row) => row.data.phase);
			expect(phases).toContain("tomorrow");
			expect(phases).toContain("today");
		});
	});
});
