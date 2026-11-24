/**
 * Notification integration tests.
 *
 * Why these run against Postgres: the notification boundary is enforced by RLS,
 * not by TypeScript. A test that mocks the database cannot prove that one
 * person's bell is unreachable from another person's request, that the insert
 * can return its own row while the actor reads nothing, or that a definer
 * function stays inside its workspace.
 *
 * Skipped unless TEST_DATABASE=1 and the URL points at app_test, so a normal
 * `bun test` never touches a real database.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { adminDb } from "../db";
import { member, organization, user } from "../db/auth-schema";
import {
	comment,
	commentThreadRead,
	milestone,
	milestoneAssignee,
	milestoneScopeEntry,
	notification,
	project,
	projectMember,
} from "../db/schema";
import { withTenant } from "../db/tenant";
import type { TenantContext } from "../middleware/tenant";
import { createMilestoneComment } from "./comment";
import {
	getProjectUnreadSummary,
	markCommentsRead,
} from "./comment-read.service";
import { updateMilestoneScopeEntry } from "./milestone/scope";
import { createNotifications } from "./notification.service";
import {
	getNotificationSummary,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
} from "./notification-query";
import { runReminderSweepForOrganization } from "./reminder.service";

const enabled =
	process.env.TEST_DATABASE === "1" &&
	(process.env.DATABASE_URL ?? "").includes("/app_test");

const suite = enabled ? describe : describe.skip;
const suffix = Date.now().toString(36);

const ids = {
	orgA: `qa-notif-org-${suffix}`,
	orgB: `qa-notif-org-b-${suffix}`,
	owner: `qa-notif-user-owner-${suffix}`,
	dev: `qa-notif-user-dev-${suffix}`,
	client: `qa-notif-user-client-${suffix}`,
	ownerB: `qa-notif-user-owner-b-${suffix}`,
	mOwner: `qa-notif-m-owner-${suffix}`,
	mDev: `qa-notif-m-dev-${suffix}`,
	mClient: `qa-notif-m-client-${suffix}`,
	mOwnerB: `qa-notif-m-owner-b-${suffix}`,
	pmOwner: `qa-notif-pm-owner-${suffix}`,
	pmDev: `qa-notif-pm-dev-${suffix}`,
	pmClient: `qa-notif-pm-client-${suffix}`,
	pmOwnerB: `qa-notif-pm-owner-b-${suffix}`,
	pMain: `qa-notif-project-main-${suffix}`,
	pArchived: `qa-notif-project-archived-${suffix}`,
	pOrgB: `qa-notif-project-org-b-${suffix}`,
	mMain: `qa-notif-milestone-main-${suffix}`,
	mComment: `qa-notif-milestone-comment-${suffix}`,
	mPages: `qa-notif-milestone-pages-${suffix}`,
	mReminder: `qa-notif-milestone-reminder-${suffix}`,
};

const slugOf = (name: string) => `qa-notif-${name}-${suffix}`;

const memberCreatedAt = new Date("2020-01-01T00:00:00Z");

function tenant(
	organizationId: string,
	userId: string,
	memberId: string,
	role: string,
	slug: string,
): TenantContext {
	return {
		organizationId,
		userId,
		memberId,
		memberCreatedAt,
		slug,
		role,
	};
}

const orgSlugA = slugOf("org");
const orgSlugB = slugOf("org-b");

const tOwner = () => tenant(ids.orgA, ids.owner, ids.mOwner, "owner", orgSlugA);
const tDev = () => tenant(ids.orgA, ids.dev, ids.mDev, "member", orgSlugA);
const tClient = () =>
	tenant(ids.orgA, ids.client, ids.mClient, "member", orgSlugA);
const tOwnerB = () =>
	tenant(ids.orgB, ids.ownerB, ids.mOwnerB, "owner", orgSlugB);

const paragraph = (text: string) => [{ type: "p", children: [{ text }] }];
const mentionBody = (text: string, userId: string, name: string) => [
	{
		type: "p",
		children: [
			{ text },
			{
				type: "mention",
				key: `user:${userId}`,
				value: name,
				children: [{ text: "" }],
			},
		],
	},
];

async function seedUser(id: string, name: string, timezone?: string | null) {
	const now = new Date();
	await adminDb.insert(user).values({
		id,
		name,
		email: `${id}@example.test`,
		emailVerified: true,
		timezone: timezone ?? null,
		createdAt: now,
		updatedAt: now,
	});
}

async function seedOrg(
	organizationId: string,
	name: string,
	members: Array<{ memberId: string; userId: string; role: string }>,
) {
	const now = new Date();
	await adminDb.insert(organization).values({
		id: organizationId,
		name,
		slug: slugOf(name.toLowerCase().replace(/\s+/g, "-")),
		createdAt: now,
	});

	await adminDb.insert(member).values(
		members.map((row) => ({
			id: row.memberId,
			organizationId,
			userId: row.userId,
			role: row.role,
			createdAt: now,
		})),
	);
}

async function seedProject(input: {
	id: string;
	organizationId: string;
	name: string;
	createdBy: string;
	archivedAt?: Date | null;
	archiveVisibleToClient?: boolean;
	members: Array<{
		projectMemberId: string;
		memberId: string;
		userId: string;
		role: string;
	}>;
}) {
	await adminDb.insert(project).values({
		id: input.id,
		organizationId: input.organizationId,
		name: input.name,
		slug: slugOf(input.name.toLowerCase().replace(/\s+/g, "-")),
		createdBy: input.createdBy,
		archivedAt: input.archivedAt ?? null,
		archiveVisibleToClient: input.archiveVisibleToClient ?? false,
	});

	if (input.members.length === 0) return;

	await adminDb.insert(projectMember).values(
		input.members.map((row) => ({
			id: row.projectMemberId,
			organizationId: input.organizationId,
			projectId: input.id,
			memberId: row.memberId,
			userId: row.userId,
			role: row.role,
		})),
	);
}

async function seedMilestone(input: {
	id: string;
	organizationId: string;
	projectId: string;
	title: string;
	status?: string;
	dueDate?: string | null;
}) {
	await adminDb.insert(milestone).values({
		id: input.id,
		organizationId: input.organizationId,
		projectId: input.projectId,
		title: input.title,
		status: input.status ?? "todo",
		dueDate: input.dueDate ?? null,
		createdBy: ids.owner,
		updatedBy: ids.owner,
	});
}

async function assign(milestoneId: string, projectMemberId: string) {
	await adminDb.insert(milestoneAssignee).values({
		id: randomUUID(),
		organizationId: ids.orgA,
		milestoneId,
		projectMemberId,
	});
}

async function rowsFor(recipientUserId: string) {
	return adminDb
		.select()
		.from(notification)
		.where(
			and(
				eq(notification.organizationId, ids.orgA),
				eq(notification.recipientUserId, recipientUserId),
			),
		);
}

async function clearNotifications() {
	await adminDb.execute(
		sql`delete from "notification" where organization_id in (${ids.orgA}, ${ids.orgB})`,
	);
}

async function countOrgNotifications(): Promise<number> {
	const rows = await adminDb.execute<{ count: number }>(
		sql`select count(*)::int as count from "notification" where organization_id = ${ids.orgA}`,
	);
	return rows[0]?.count ?? 0;
}

async function cleanup() {
	try {
		await adminDb.execute(
			sql`delete from "organization" where id in (${ids.orgA}, ${ids.orgB})`,
		);
		await adminDb.execute(
			sql`delete from "user" where id in (${ids.owner}, ${ids.dev}, ${ids.client}, ${ids.ownerB})`,
		);
	} catch {
		// Cleanup must never hide a test result.
	}
}

suite("notification system", () => {
	beforeAll(async () => {
		await seedUser(ids.owner, "Owner A");
		await seedUser(ids.dev, "Dev A", "UTC");
		await seedUser(ids.client, "Client A");
		await seedUser(ids.ownerB, "Owner B");

		await seedOrg(ids.orgA, "Notif Org", [
			{ memberId: ids.mOwner, userId: ids.owner, role: "owner" },
			{ memberId: ids.mDev, userId: ids.dev, role: "member" },
			{ memberId: ids.mClient, userId: ids.client, role: "member" },
		]);
		await seedOrg(ids.orgB, "Notif Org B", [
			{ memberId: ids.mOwnerB, userId: ids.ownerB, role: "owner" },
		]);

		await seedProject({
			id: ids.pMain,
			organizationId: ids.orgA,
			name: "Main",
			createdBy: ids.owner,
			members: [
				{
					projectMemberId: ids.pmOwner,
					memberId: ids.mOwner,
					userId: ids.owner,
					role: "owner",
				},
				{
					projectMemberId: ids.pmDev,
					memberId: ids.mDev,
					userId: ids.dev,
					role: "member",
				},
				{
					projectMemberId: ids.pmClient,
					memberId: ids.mClient,
					userId: ids.client,
					role: "client",
				},
			],
		});
		await seedProject({
			id: ids.pArchived,
			organizationId: ids.orgA,
			name: "Old",
			createdBy: ids.owner,
			archivedAt: new Date(),
			archiveVisibleToClient: false,
			members: [
				{
					projectMemberId: `qa-ac-pm-owner-${suffix}`,
					memberId: ids.mOwner,
					userId: ids.owner,
					role: "owner",
				},
				{
					projectMemberId: `qa-ac-pm-dev-${suffix}`,
					memberId: ids.mDev,
					userId: ids.dev,
					role: "member",
				},
			],
		});
		await seedProject({
			id: ids.pOrgB,
			organizationId: ids.orgB,
			name: "Other",
			createdBy: ids.ownerB,
			members: [
				{
					projectMemberId: ids.pmOwnerB,
					memberId: ids.mOwnerB,
					userId: ids.ownerB,
					role: "owner",
				},
			],
		});

		await seedMilestone({
			id: ids.mMain,
			organizationId: ids.orgA,
			projectId: ids.pMain,
			title: "Main milestone",
		});
		await seedMilestone({
			id: ids.mComment,
			organizationId: ids.orgA,
			projectId: ids.pMain,
			title: "Comment milestone",
		});
		await seedMilestone({
			id: ids.mPages,
			organizationId: ids.orgA,
			projectId: ids.pMain,
			title: "Pages milestone",
		});
		await seedMilestone({
			id: ids.mReminder,
			organizationId: ids.orgA,
			projectId: ids.pMain,
			title: "Reminder milestone",
			dueDate: "2026-11-24",
		});

		await assign(ids.mMain, ids.pmDev);
		await assign(ids.mReminder, ids.pmDev);
	});

	afterAll(async () => {
		// Fixtures only. The shared database and Redis clients belong to the
		// whole test process, so they are not closed here: doing that broke the
		// next integration file with CONNECTION_ENDED.
		await cleanup();
	});

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

	describe("scope mention lifecycle", () => {
		const entryId = `qa-notif-scope-${suffix}`;

		async function seedEntry() {
			await adminDb.execute(
				sql`delete from "milestone_scope_entry" where id = ${entryId}`,
			);
			await adminDb.insert(milestoneScopeEntry).values({
				id: entryId,
				organizationId: ids.orgA,
				projectId: ids.pMain,
				milestoneId: ids.mComment,
				kind: "change",
				title: "Scope section",
				body: paragraph("empty"),
				bodyText: "empty",
				createdBy: ids.owner,
				updatedBy: ids.owner,
			});
		}

		test("adding a mention then removing it leaves no row", async () => {
			await clearNotifications();
			await seedEntry();

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: mentionBody("Ping ", ids.dev, "Dev A") },
			);
			expect((await rowsFor(ids.dev)).length).toBe(1);

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: paragraph("No mention now") },
			);
			expect((await rowsFor(ids.dev)).length).toBe(0);
		});

		test("re-adding the same mention across edits keeps one row", async () => {
			await clearNotifications();
			await seedEntry();

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: mentionBody("Ping ", ids.dev, "Dev A") },
			);
			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: paragraph("gone") },
			);
			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: mentionBody("Ping again ", ids.dev, "Dev A") },
			);

			// The key no longer carries the edit timestamp, so the unique index
			// collapses the re-add into the same row.
			const rows = await rowsFor(ids.dev);
			expect(rows.length).toBe(1);
			expect(rows[0]?.dedupeKey).toBe(`mention:scope:${entryId}:${ids.dev}`);
		});

		test("removing one mention leaves the other recipient alone", async () => {
			await clearNotifications();
			await seedEntry();

			const both = [
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

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: both },
			);

			expect((await rowsFor(ids.dev)).length).toBe(1);
			expect((await rowsFor(ids.client)).length).toBe(1);

			await updateMilestoneScopeEntry(
				tOwner(),
				ids.pMain,
				ids.mComment,
				entryId,
				{ body: mentionBody("Only ", ids.client, "Client A") },
			);

			expect((await rowsFor(ids.dev)).length).toBe(0);
			expect((await rowsFor(ids.client)).length).toBe(1);
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
