/**
 * Comment notification checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `notification-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { adminDb } from "../db";
import {
	comment,
	commentThreadRead,
	milestone,
	notification,
} from "../db/schema";
import { withTenant } from "../db/tenant";

import { createMilestoneComment } from "./comment";
import { getProjectUnreadSummary, markCommentsRead } from "./comment-read";
import {
	cleanupNotificationFixture,
	clearNotifications,
	ids,
	mentionBody,
	paragraph,
	rowsFor,
	seedNotificationFixture,
	suffix,
	suite,
	tDev,
	tOwner,
} from "./notification-fixtures";
import { listNotifications } from "./notification-query";

suite("notification comments", () => {
	beforeAll(seedNotificationFixture);
	afterAll(cleanupNotificationFixture);

	describe("comment notifications", () => {
		test("a mention wins over assignment fan-out and the actor gets nothing", async () => {
			await clearNotifications();

			const result = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				{ body: mentionBody("Please review ", ids.dev, "Dev A") },
			);

			const devRows = await rowsFor(ids.dev);
			expect(devRows.length).toBe(1);
			expect(devRows[0]?.type).toBe("mention");
			expect(devRows[0]?.commentId).toBe(result.comment.id);

			const clientRows = await rowsFor(ids.client);
			expect(clientRows.length).toBe(1);
			expect(clientRows[0]?.type).toBe("comment_new");

			expect((await rowsFor(ids.owner)).length).toBe(0);
			expect(result.notifications.length).toBe(2);
		});

		test("a reply notifies the parent author once, even when mentioned too", async () => {
			await clearNotifications();

			const root = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				{ body: paragraph("Root message") },
			);

			await clearNotifications();

			const reply = await createMilestoneComment(
				tDev(),
				ids.pMain,
				ids.mComment,
				{
					body: mentionBody("Answering ", ids.owner, "Owner A"),
					parentId: root.comment.id,
				},
			);

			const ownerRows = await rowsFor(ids.owner);
			expect(ownerRows.length).toBe(1);
			expect(ownerRows[0]?.type).toBe("mention");

			const clientRows = await rowsFor(ids.client);
			expect(clientRows.length).toBe(0);

			expect(reply.comment.parentId).toBe(root.comment.id);
		});

		test("removing a mention by editing deletes the bell row", async () => {
			await clearNotifications();

			const created = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				{ body: mentionBody("Ping ", ids.dev, "Dev A") },
			);

			expect((await rowsFor(ids.dev)).length).toBe(1);

			const { updateMilestoneComment } = await import("./comment");

			await updateMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				created.comment.id,
				{ body: paragraph("No mention now") },
			);

			expect((await rowsFor(ids.dev)).length).toBe(0);
		});

		test("an edit that keeps the mention keeps the bell row", async () => {
			await clearNotifications();

			const created = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				{ body: mentionBody("Ping ", ids.dev, "Dev A") },
			);

			expect((await rowsFor(ids.dev)).length).toBe(1);

			const { updateMilestoneComment } = await import("./comment");

			await updateMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				created.comment.id,
				{ body: mentionBody("Ping again ", ids.dev, "Dev A") },
			);

			const rows = await rowsFor(ids.dev);
			expect(rows.length).toBe(1);
			expect(rows[0]?.readAt).toBeNull();
		});

		test("a mention removed from one recipient leaves another recipient alone", async () => {
			await clearNotifications();

			const body = [
				{
					type: "p",
					children: [
						{ text: "Both " },
						{
							type: "mention",
							key: `user:${ids.dev}`,
							value: "Dev A",
							children: [{ text: "" }],
						},
						{
							type: "mention",
							key: `user:${ids.client}`,
							value: "Client A",
							children: [{ text: "" }],
						},
					],
				},
			];

			const created = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				{ body },
			);

			expect((await rowsFor(ids.dev)).length).toBe(1);
			expect((await rowsFor(ids.client)).length).toBe(1);

			const { updateMilestoneComment } = await import("./comment");

			// Keep only the client mention, so only dev should lose the row.
			await updateMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				created.comment.id,
				{ body: mentionBody("Only ", ids.client, "Client A") },
			);

			expect((await rowsFor(ids.dev)).length).toBe(0);
			expect((await rowsFor(ids.client)).length).toBe(1);
		});

		test("deleting a comment removes its notifications for every recipient", async () => {
			await clearNotifications();

			const { deleteMilestoneComment } = await import("./comment");

			const body = [
				{
					type: "p",
					children: [
						{ text: "Both " },
						{
							type: "mention",
							key: `user:${ids.dev}`,
							value: "Dev A",
							children: [{ text: "" }],
						},
						{
							type: "mention",
							key: `user:${ids.client}`,
							value: "Client A",
							children: [{ text: "" }],
						},
					],
				},
			];

			const created = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				{ body },
			);

			expect((await rowsFor(ids.dev)).length).toBe(1);
			expect((await rowsFor(ids.client)).length).toBe(1);

			await deleteMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				created.comment.id,
			);

			// The author can read neither row, so this only works through the
			// definer function.
			const remaining = await adminDb.execute<{ count: number }>(
				sql`select count(*)::int as count from "notification"
					where comment_id = ${created.comment.id}`,
			);
			expect(remaining[0]?.count ?? 0).toBe(0);
			expect((await rowsFor(ids.dev)).length).toBe(0);
			expect((await rowsFor(ids.client)).length).toBe(0);
		});

		test("the cleanup function cannot reach another workspace", async () => {
			await clearNotifications();

			// A comment in workspace B, with a notification that must survive a
			// call made from workspace A.
			const otherMilestoneId = `qa-notif-milestone-other-${suffix}`;
			await adminDb.insert(milestone).values({
				id: otherMilestoneId,
				organizationId: ids.orgB,
				projectId: ids.pOrgB,
				title: "Other milestone",
				status: "todo",
				createdBy: ids.ownerB,
				updatedBy: ids.ownerB,
			});

			const otherCommentId = `qa-notif-other-comment-${suffix}`;
			await adminDb.insert(comment).values({
				id: otherCommentId,
				organizationId: ids.orgB,
				milestoneId: otherMilestoneId,
				authorId: ids.ownerB,
				body: paragraph("other"),
				bodyText: "other",
			});
			await adminDb.insert(notification).values({
				id: randomUUID(),
				organizationId: ids.orgB,
				recipientUserId: ids.ownerB,
				actorUserId: ids.ownerB,
				type: "mention",
				dedupeKey: `mention:other:${suffix}`,
				commentId: otherCommentId,
			});

			const { deleteCommentNotifications } = await import(
				"./notification.service"
			);

			const deleted = await withTenant(
				{ organizationId: ids.orgA, userId: ids.owner },
				(tx) => deleteCommentNotifications(tx, otherCommentId),
			);

			expect(deleted).toBe(0);

			const rows = await adminDb.execute<{ count: number }>(
				sql`select count(*)::int as count from "notification" where comment_id = ${otherCommentId}`,
			);
			expect(rows[0]?.count ?? 0).toBe(1);

			await adminDb.execute(
				sql`delete from "notification" where comment_id = ${otherCommentId}`,
			);
			await adminDb.execute(
				sql`delete from "comment" where id = ${otherCommentId}`,
			);
			await adminDb.execute(
				sql`delete from "milestone" where id = ${otherMilestoneId}`,
			);
		});

		test("marking a thread read clears its comment notifications", async () => {
			await clearNotifications();
			await adminDb.execute(
				sql`delete from "comment" where milestone_id = ${ids.mComment}`,
			);

			const created = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mComment,
				{ body: mentionBody("Look ", ids.dev, "Dev A") },
			);

			const unreadBefore = await listNotifications(tDev(), {
				cursor: null,
				limit: 10,
				filter: "unread",
			});
			expect(unreadBefore.unread).toBeGreaterThan(0);

			const read = await markCommentsRead(tDev(), ids.pMain, ids.mComment, [
				created.comment.id,
			]);

			expect(read.unreadTotal).toBe(0);

			const devRows = await rowsFor(ids.dev);
			expect(devRows[0]?.readAt).not.toBeNull();
		});

		test("the thread cursor never moves backwards", async () => {
			await clearNotifications();
			await adminDb.execute(
				sql`delete from "comment_thread_read" where milestone_id = ${ids.mPages}`,
			);

			const older = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mPages,
				{ body: paragraph("first") },
			);
			const newer = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mPages,
				{ body: paragraph("second") },
			);

			await markCommentsRead(tDev(), ids.pMain, ids.mPages, [newer.comment.id]);

			let [cursor] = await adminDb
				.select()
				.from(commentThreadRead)
				.where(eq(commentThreadRead.rootCommentId, newer.comment.id));

			expect(cursor?.lastReadCommentId).toBe(newer.comment.id);

			// A late request for an older comment must not rewind the cursor.
			await markCommentsRead(tDev(), ids.pMain, ids.mPages, [older.comment.id]);

			[cursor] = await adminDb
				.select()
				.from(commentThreadRead)
				.where(eq(commentThreadRead.rootCommentId, newer.comment.id));

			expect(cursor?.lastReadCommentId).toBe(newer.comment.id);
		});

		test("KNOWN: unread only drops for threads the client marked", async () => {
			await clearNotifications();
			await adminDb.execute(
				sql`delete from "comment" where milestone_id = ${ids.mPages}`,
			);

			const first = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mPages,
				{ body: paragraph("one") },
			);
			await createMilestoneComment(tOwner(), ids.pMain, ids.mPages, {
				body: paragraph("two"),
			});
			const third = await createMilestoneComment(
				tOwner(),
				ids.pMain,
				ids.mPages,
				{ body: paragraph("three") },
			);

			const result = await markCommentsRead(tDev(), ids.pMain, ids.mPages, [
				third.comment.id,
			]);

			// The milestone tab badge reports 2 even though the UI loaded the
			// newer page and showed all three roots.
			expect(result.unreadTotal).toBe(2);

			const summary = await getProjectUnreadSummary(tDev(), ids.pMain);
			const page = summary.milestones.find(
				(item) => item.milestoneId === ids.mPages,
			);
			expect(page?.unread).toBe(2);

			expect(first.comment.id.length).toBeGreaterThan(0);
		});
	});
});
