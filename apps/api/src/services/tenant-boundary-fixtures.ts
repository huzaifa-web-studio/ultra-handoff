/**
 * Tenant and project boundary fixtures.
 *
 * Why this file: every boundary suite needs the same two workspaces, users,
 * projects and milestones. The seed and cleanup live here so each scenario file
 * proves the same starting state and leaves none behind.
 *
 * Used by: the `tenant-boundary-*.integration.test.ts` files.
 */

import { describe } from "bun:test";

import { sql } from "drizzle-orm";

import { adminDb } from "../db";
import { invitation, member, organization, user } from "../db/auth-schema";
import { milestone, project, projectMember } from "../db/schema";
import type { TenantContext } from "../middleware/tenant";

/** The suite only runs against the throwaway test database. */
export const enabled =
	process.env.TEST_DATABASE === "1" &&
	(process.env.DATABASE_URL ?? "").includes("/app_test");

export const suite = enabled ? describe : describe.skip;

export const suffix = Date.now().toString(36);

export const ids = {
	orgA: `qa-org-a-${suffix}`,
	orgB: `qa-org-b-${suffix}`,
	ownerA: `qa-user-owner-a-${suffix}`,
	adminA: `qa-user-admin-a-${suffix}`,
	memberA: `qa-user-member-a-${suffix}`,
	clientA: `qa-user-client-a-${suffix}`,
	ownerB: `qa-user-owner-b-${suffix}`,
	outsiderB: `qa-user-outsider-b-${suffix}`,
	mOwnerA: `qa-member-owner-a-${suffix}`,
	mAdminA: `qa-member-admin-a-${suffix}`,
	mMemberA: `qa-member-member-a-${suffix}`,
	mClientA: `qa-member-client-a-${suffix}`,
	mOwnerB: `qa-member-owner-b-${suffix}`,
	mOutsiderB: `qa-member-outsider-b-${suffix}`,
	pVisibleA: `qa-project-visible-a-${suffix}`,
	pHiddenA: `qa-project-hidden-a-${suffix}`,
	pOverlayA: `qa-project-overlay-a-${suffix}`,
	pOrgB: `qa-project-org-b-${suffix}`,
	mVisible: `qa-milestone-visible-${suffix}`,
	mHidden: `qa-milestone-hidden-${suffix}`,
	mOrgB: `qa-milestone-org-b-${suffix}`,
};

export const slug = (name: string) => `qa-${name}-${suffix}`;

/** Projects used only by the bulk action tests. */
export const bulkIds = Array.from(
	{ length: 10 },
	(_, index) => `qa-bulk-project-${suffix}-${index}`,
);

/** Plain paragraph body, so no link preview worker is touched. */
export const paragraph = (text: string) => [
	{ type: "p", children: [{ text }] },
];

/** Join every text leaf in a sanitized Plate value, for assertions. */
export function bodyText(value: unknown): string {
	if (Array.isArray(value)) return value.map(bodyText).join("");
	if (!value || typeof value !== "object") return "";

	const record = value as Record<string, unknown>;
	if (typeof record.text === "string") return record.text;

	return Array.isArray(record.children) ? bodyText(record.children) : "";
}

/** Find the sanitized id and checked state of the first checklist item. */
export function findChecklistItem(
	value: unknown,
): { id: string; checked: boolean } | null {
	if (Array.isArray(value)) {
		for (const node of value) {
			const found = findChecklistItem(node);
			if (found) return found;
		}

		return null;
	}

	if (!value || typeof value !== "object") return null;

	const record = value as Record<string, unknown>;

	if (typeof record.id === "string" && typeof record.checked === "boolean") {
		return { id: record.id, checked: record.checked };
	}

	return Array.isArray(record.children)
		? findChecklistItem(record.children)
		: null;
}

/** One checklist list, in the shape the editor and sanitizer produce. */
export const checklistBody = () => [
	{
		type: "taskList",
		children: [
			{
				type: "li",
				checked: false,
				children: [{ type: "lic", children: [{ text: "Ship it" }] }],
			},
		],
	},
];

export function tenant(
	organizationId: string,
	userId: string,
	memberId: string,
	role: string,
): TenantContext {
	return {
		organizationId,
		userId,
		memberId,
		memberCreatedAt: new Date("2026-01-01T00:00:00Z"),
		slug: "qa",
		role,
	};
}

export const tenantOwnerA = () =>
	tenant(ids.orgA, ids.ownerA, ids.mOwnerA, "owner");
export const tenantAdminA = () =>
	tenant(ids.orgA, ids.adminA, ids.mAdminA, "admin");
export const tenantMemberA = () =>
	tenant(ids.orgA, ids.memberA, ids.mMemberA, "member");
export const tenantClientA = () =>
	tenant(ids.orgA, ids.clientA, ids.mClientA, "member");
export const tenantOwnerB = () =>
	tenant(ids.orgB, ids.ownerB, ids.mOwnerB, "owner");

export const projectQuery = {
	search: "",
	status: "all" as const,
	sort: "createdAt" as const,
	direction: "desc" as const,
	page: 1,
	pageSize: 50,
};

export const milestoneQuery = {
	search: "",
	status: "all" as const,
	sort: "dueDate" as const,
	direction: "asc" as const,
	page: 1,
	pageSize: 50,
};

/** One user row, enough for the service lookups. */
export async function seedUser(id: string, name: string): Promise<void> {
	const now = new Date();

	await adminDb.insert(user).values({
		id,
		name,
		email: `${id}@example.test`,
		emailVerified: true,
		createdAt: now,
		updatedAt: now,
	});
}

/** One organization plus its membership rows. */
export async function seedOrganization(
	organizationId: string,
	name: string,
	members: Array<{ memberId: string; userId: string; role: string }>,
): Promise<void> {
	const now = new Date();

	await adminDb.insert(organization).values({
		id: organizationId,
		name,
		slug: slug(name.toLowerCase().replace(/\s+/g, "-")),
		createdAt: now,
	});

	if (members.length === 0) return;

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

/** One project, seeded on the privileged client so RLS does not block setup. */
export async function seedProject(
	projectId: string,
	organizationId: string,
	name: string,
	members: Array<{
		projectMemberId: string;
		memberId: string;
		userId: string;
		role: string;
	}> = [],
): Promise<void> {
	await adminDb.insert(project).values({
		id: projectId,
		organizationId,
		name,
		slug: slug(name.toLowerCase().replace(/\s+/g, "-")),
		createdBy: organizationId === ids.orgB ? ids.ownerB : ids.ownerA,
	});

	if (members.length === 0) return;

	await adminDb.insert(projectMember).values(
		members.map((row) => ({
			id: row.projectMemberId,
			organizationId,
			projectId,
			memberId: row.memberId,
			userId: row.userId,
			role: row.role,
		})),
	);
}

/** One milestone, seeded the same way. */
export async function seedMilestone(
	milestoneId: string,
	organizationId: string,
	projectId: string,
	title: string,
): Promise<void> {
	await adminDb.insert(milestone).values({
		id: milestoneId,
		organizationId,
		projectId,
		title,
		createdBy: organizationId === ids.orgB ? ids.ownerB : ids.ownerA,
		updatedBy: organizationId === ids.orgB ? ids.ownerB : ids.ownerA,
	});
}

export async function cleanup(): Promise<void> {
	try {
		await adminDb.execute(
			sql`delete from "organization" where id in (${ids.orgA}, ${ids.orgB})`,
		);
		await adminDb.execute(
			sql`delete from "user" where id in (${ids.ownerA}, ${ids.adminA}, ${ids.memberA}, ${ids.clientA}, ${ids.ownerB}, ${ids.outsiderB})`,
		);
	} catch {
		// A failed cleanup must not hide the test result.
	}
}

export async function seedTenantBoundaryFixture(): Promise<void> {
	await seedUser(ids.ownerA, "Owner A");
	await seedUser(ids.adminA, "Admin A");
	await seedUser(ids.memberA, "Member A");
	await seedUser(ids.clientA, "Client A");
	await seedUser(ids.ownerB, "Owner B");
	await seedUser(ids.outsiderB, "Outsider B");

	await seedOrganization(ids.orgA, "QA Org A", [
		{ memberId: ids.mOwnerA, userId: ids.ownerA, role: "owner" },
		{ memberId: ids.mAdminA, userId: ids.adminA, role: "admin" },
		{ memberId: ids.mMemberA, userId: ids.memberA, role: "member" },
		{ memberId: ids.mClientA, userId: ids.clientA, role: "member" },
	]);
	await seedOrganization(ids.orgB, "QA Org B", [
		{ memberId: ids.mOwnerB, userId: ids.ownerB, role: "owner" },
		{ memberId: ids.mOutsiderB, userId: ids.outsiderB, role: "member" },
	]);

	await seedProject(ids.pVisibleA, ids.orgA, "Visible A", [
		{
			projectMemberId: `qa-pm-owner-a-${suffix}`,
			memberId: ids.mOwnerA,
			userId: ids.ownerA,
			role: "owner",
		},
		{
			projectMemberId: `qa-pm-admin-a-${suffix}`,
			memberId: ids.mAdminA,
			userId: ids.adminA,
			role: "admin",
		},
		{
			projectMemberId: `qa-pm-member-a-${suffix}`,
			memberId: ids.mMemberA,
			userId: ids.memberA,
			role: "member",
		},
		{
			projectMemberId: `qa-pm-client-a-${suffix}`,
			memberId: ids.mClientA,
			userId: ids.clientA,
			role: "client",
		},
	]);
	await seedProject(ids.pHiddenA, ids.orgA, "Hidden A", [
		{
			projectMemberId: `qa-pm-hidden-a-${suffix}`,
			memberId: ids.mOwnerA,
			userId: ids.ownerA,
			role: "owner",
		},
	]);
	// No project_member rows at all, to prove the organization owner overlay.
	await seedProject(ids.pOverlayA, ids.orgA, "Overlay A");
	await seedProject(ids.pOrgB, ids.orgB, "Org B Project", [
		{
			projectMemberId: `qa-pm-org-b-${suffix}`,
			memberId: ids.mOwnerB,
			userId: ids.ownerB,
			role: "owner",
		},
	]);

	await seedMilestone(
		ids.mVisible,
		ids.orgA,
		ids.pVisibleA,
		"Visible milestone",
	);
	await seedMilestone(ids.mHidden, ids.orgA, ids.pHiddenA, "Hidden milestone");
	await seedMilestone(ids.mOrgB, ids.orgB, ids.pOrgB, "Org B milestone");

	// Bulk action fixture: ten projects owned by owner A.
	for (const [index, projectId] of bulkIds.entries()) {
		await seedProject(projectId, ids.orgA, `Bulk ${index}`, [
			{
				projectMemberId: `qa-bulk-pm-${suffix}-${index}`,
				memberId: ids.mOwnerA,
				userId: ids.ownerA,
				role: "owner",
			},
		]);
	}

	// Invitation history fixture: 1000 rows with a known status mix.
	const now = Date.now();
	const inviteRows = Array.from({ length: 1000 }, (_, index) => {
		const status =
			index % 10 === 0 ? "accepted" : index % 17 === 0 ? "canceled" : "pending";
		const expired = status === "pending" && index % 3 === 0;

		return {
			id: `qa-invite-${suffix}-${index}`,
			organizationId: ids.orgA,
			email: `qa-invite-${index}@example.test`,
			role: index % 5 === 0 ? "admin" : "member",
			status,
			expiresAt: new Date(now + (expired ? -86_400_000 : 86_400_000)),
			createdAt: new Date(now - index * 60_000),
			inviterId: ids.ownerA,
		};
	});

	await adminDb.insert(invitation).values(inviteRows);
}

export async function cleanupTenantBoundaryFixture(): Promise<void> {
	// Fixtures only. The shared database and Redis clients belong to the
	// whole test process. Ending them here broke the next integration file
	// with CONNECTION_ENDED, so they are left for the process to close.
	await cleanup();
}
