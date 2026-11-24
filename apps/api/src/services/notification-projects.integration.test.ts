/**
 * Project and organization notification checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `notification-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { adminDb } from "../db";
import { member, user } from "../db/auth-schema";
import { withTenant } from "../db/tenant";

import { createMilestoneComment } from "./comment";

import { createNotifications } from "./notification.service";
import {
	cleanupNotificationFixture,
	clearNotifications,
	ids,
	mentionBody,
	orgSlugA,
	rowsFor,
	seedNotificationFixture,
	suffix,
	suite,
	tDev,
	tOwner,
} from "./notification-fixtures";
import { listNotifications } from "./notification-query";

suite("notification projects", () => {
	beforeAll(seedNotificationFixture);
	afterAll(cleanupNotificationFixture);

	describe("project and organization notifications", () => {
		test("one writer call returns a row for every recipient", async () => {
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
								type: "member_joined",
								dedupeKey: "multi-1",
								organizationName: "Notif Org",
							},
							{
								recipientUserId: ids.client,
								actorUserId: ids.owner,
								type: "member_joined",
								dedupeKey: "multi-2",
								organizationName: "Notif Org",
							},
						],
					),
			);

			expect(deliveries.length).toBe(2);
			expect(deliveries.map((row) => row.recipientUserId).sort()).toEqual(
				[ids.dev, ids.client].sort(),
			);
			expect((await rowsFor(ids.dev)).length).toBe(1);
			expect((await rowsFor(ids.client)).length).toBe(1);
		});

		test("adding a project member notifies the new member only", async () => {
			await clearNotifications();

			const newUser = `qa-notif-user-new-${suffix}`;
			const newMember = `qa-notif-m-new-${suffix}`;
			const now = new Date();

			await adminDb.insert(user).values({
				id: newUser,
				name: "New Person",
				email: `${newUser}@example.test`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now,
			});
			await adminDb.insert(member).values({
				id: newMember,
				organizationId: ids.orgA,
				userId: newUser,
				role: "member",
				createdAt: now,
			});

			const { addProjectMember } = await import("./project");

			const result = await addProjectMember(
				tOwner(),
				ids.pMain,
				newUser,
				"member",
			);

			expect(result.userId).toBe(newUser);
			expect(result.notifications.length).toBe(1);

			const rows = await rowsFor(newUser);
			expect(rows.length).toBe(1);
			expect(rows[0]?.type).toBe("project_member_added");
			expect(rows[0]?.data).toMatchObject({ role: "member" });
			expect((await rowsFor(ids.owner)).length).toBe(0);

			await adminDb.execute(sql`delete from "user" where id = ${newUser}`);
		});

		test("changing a project role notifies that person", async () => {
			await clearNotifications();

			const { updateProjectMemberRole } = await import("./project");

			const result = await updateProjectMemberRole(
				tOwner(),
				ids.pMain,
				ids.dev,
				"admin",
			);

			expect(result.notifications.length).toBe(1);

			const rows = await rowsFor(ids.dev);
			expect(rows.length).toBe(1);
			expect(rows[0]?.type).toBe("project_role_changed");
			expect(rows[0]?.data).toMatchObject({ role: "admin" });
			expect((await rowsFor(ids.owner)).length).toBe(0);

			await updateProjectMemberRole(tOwner(), ids.pMain, ids.dev, "member");
		});

		test("archive notifies managers only; restore notifies every member", async () => {
			await clearNotifications();

			const { setProjectArchived } = await import("./project");

			const restored = await setProjectArchived(tOwner(), ids.pArchived, false);

			expect(restored.notifications.map((row) => row.recipientUserId)).toEqual([
				ids.dev,
			]);
			expect(restored.notifications[0]?.type).toBe("project_unarchived");
			expect((await rowsFor(ids.owner)).length).toBe(0);

			await clearNotifications();

			const archived = await setProjectArchived(tOwner(), ids.pArchived, true);

			// dev holds the plain member project role on this project, so an
			// archive does not target them.
			expect(archived.notifications.length).toBe(0);

			await setProjectArchived(tOwner(), ids.pArchived, false);
		});

		test("a soft deleted comment hides its notification without deleting the row", async () => {
			await clearNotifications();

			const { deleteMilestoneComment } = await import("./comment");

			const created = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				{ body: mentionBody("Deleting ", ids.dev, "Dev A") },
			);

			expect((await rowsFor(ids.dev)).length).toBe(1);

			await deleteMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				created.comment.id,
			);

			const page = await listNotifications(tDev(), {
				cursor: null,
				limit: 20,
				filter: "all",
			});

			expect(page.notifications.length).toBe(0);
			expect(page.unread).toBe(0);

			// The cleanup now runs through the definer function, so the row is
			// actually gone rather than hidden by the read filter.
			expect((await rowsFor(ids.dev)).length).toBe(0);
		});
	});
});
