/**
 * Notification integration fixtures.
 *
 * Why this file: the notification suites share one seeded workspace, one set of
 * users and a handful of helpers. Keeping the seed and cleanup here means each
 * scenario file starts from the same state and leaves none behind.
 *
 * The suites run one file at a time, so the shared ids are reused safely.
 *
 * Used by: the `notification-*.integration.test.ts` files.
 */

import { describe } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { adminDb } from "../db";
import { member, organization, user } from "../db/auth-schema";
import {
	milestone,
	milestoneAssignee,
	notification,
	project,
	projectMember,
} from "../db/schema";

import type { TenantContext } from "../middleware/tenant";

export const enabled =
	process.env.TEST_DATABASE === "1" &&
	(process.env.DATABASE_URL ?? "").includes("/app_test");

export const suite = enabled ? describe : describe.skip;
export const suffix = Date.now().toString(36);

export const ids = {
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

export const slugOf = (name: string) => `qa-notif-${name}-${suffix}`;

export const memberCreatedAt = new Date("2020-01-01T00:00:00Z");

export function tenant(
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
		name: "QA Person",
	};
}

export const orgSlugA = slugOf("org");
export const orgSlugB = slugOf("org-b");

export const tOwner = () =>
	tenant(ids.orgA, ids.owner, ids.mOwner, "owner", orgSlugA);
export const tDev = () =>
	tenant(ids.orgA, ids.dev, ids.mDev, "member", orgSlugA);
export const tClient = () =>
	tenant(ids.orgA, ids.client, ids.mClient, "member", orgSlugA);
export const tOwnerB = () =>
	tenant(ids.orgB, ids.ownerB, ids.mOwnerB, "owner", orgSlugB);

export const paragraph = (text: string) => [
	{ type: "p", children: [{ text }] },
];
export const mentionBody = (text: string, userId: string, name: string) => [
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

export async function seedUser(
	id: string,
	name: string,
	timezone?: string | null,
) {
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

export async function seedOrg(
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

export async function seedProject(input: {
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

export async function seedMilestone(input: {
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

export async function assign(milestoneId: string, projectMemberId: string) {
	await adminDb.insert(milestoneAssignee).values({
		id: randomUUID(),
		organizationId: ids.orgA,
		milestoneId,
		projectMemberId,
	});
}

export async function rowsFor(recipientUserId: string) {
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

export async function clearNotifications() {
	await adminDb.execute(
		sql`delete from "notification" where organization_id in (${ids.orgA}, ${ids.orgB})`,
	);
}

export async function countOrgNotifications(): Promise<number> {
	const rows = await adminDb.execute<{ count: number }>(
		sql`select count(*)::int as count from "notification" where organization_id = ${ids.orgA}`,
	);
	return rows[0]?.count ?? 0;
}

export async function cleanup() {
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

export async function seedNotificationFixture(): Promise<void> {
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
}

export async function cleanupNotificationFixture(): Promise<void> {
	// Fixtures only. The shared database and Redis clients belong to the
	// whole test process, so they are not closed here: doing that broke the
	// next integration file with CONNECTION_ENDED.
	await cleanup();
}
