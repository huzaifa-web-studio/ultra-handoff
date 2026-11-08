/**
 * Tenant and project boundary, against a real database.
 *
 * Why this file exists: the unit tests prove the predicates, but not that the
 * services apply them in the right order against Postgres and row level
 * security. This suite seeds two organizations, three projects and three
 * milestones, then tries to cross every boundary an attacker would try.
 *
 * Safety: the suite is skipped unless TEST_DATABASE=1 and the admin URL points
 * at a database whose name ends in `app_test`. It never touches the dev data.
 *
 * Run with:
 *   cd apps/api
 *   TEST_DATABASE=1 \
 *   DATABASE_URL=postgres://app:app@localhost:5432/app_test \
 *   DATABASE_APP_URL=postgres://app_tenant:tenant@localhost:5432/app_test \
 *   bun test src/services/tenant-boundary.integration.test.ts
 *
 * Used by: the phase 2 test report. Not part of the application runtime.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { adminClient, adminDb } from "../db";
import { member, organization, user } from "../db/auth-schema";
import { milestone, project, projectMember } from "../db/schema";
import { closeTenantDb, getTenantDb, withTenant } from "../db/tenant";
import { closeRedis } from "../lib/redis";
import type { TenantContext } from "../middleware/tenant";
import {
	createMilestoneComment,
	deleteMilestoneComment,
	listMilestoneComments,
	updateMilestoneComment,
} from "./comment.service";
import {
	createMilestone,
	deleteMilestone,
	getMilestone,
	listMilestones,
	setMilestoneAssignees,
	updateMilestone,
} from "./milestone.service";
import {
	addProjectMember,
	createProject,
	deleteProject,
	getProjectDetail,
	getProjectDetailBySlug,
	listProjects,
	setProjectArchived,
	setProjectArchiveVisibility,
	updateProject,
} from "./project.service";

/** The suite only runs against the throwaway test database. */
const enabled =
	process.env.TEST_DATABASE === "1" &&
	(process.env.DATABASE_URL ?? "").includes("/app_test");

const suite = enabled ? describe : describe.skip;

const suffix = Date.now().toString(36);

const ids = {
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

const slug = (name: string) => `qa-${name}-${suffix}`;

/** Plain paragraph body, so no link preview worker is touched. */
const paragraph = (text: string) => [{ type: "p", children: [{ text }] }];

/** Join every text leaf in a sanitized Plate value, for assertions. */
function bodyText(value: unknown): string {
	if (Array.isArray(value)) return value.map(bodyText).join("");
	if (!value || typeof value !== "object") return "";

	const record = value as Record<string, unknown>;
	if (typeof record.text === "string") return record.text;

	return Array.isArray(record.children) ? bodyText(record.children) : "";
}

function tenant(
	organizationId: string,
	userId: string,
	memberId: string,
	role: string,
): TenantContext {
	return { organizationId, userId, memberId, slug: "qa", role };
}

const tenantOwnerA = () => tenant(ids.orgA, ids.ownerA, ids.mOwnerA, "owner");
const tenantAdminA = () => tenant(ids.orgA, ids.adminA, ids.mAdminA, "admin");
const tenantMemberA = () =>
	tenant(ids.orgA, ids.memberA, ids.mMemberA, "member");
const tenantClientA = () =>
	tenant(ids.orgA, ids.clientA, ids.mClientA, "member");
const tenantOwnerB = () => tenant(ids.orgB, ids.ownerB, ids.mOwnerB, "owner");

const projectQuery = {
	search: "",
	status: "all" as const,
	sort: "createdAt" as const,
	direction: "desc" as const,
	page: 1,
	pageSize: 50,
};

const milestoneQuery = {
	search: "",
	status: "all" as const,
	sort: "dueDate" as const,
	direction: "asc" as const,
	page: 1,
	pageSize: 50,
};

/** One user row, enough for the service lookups. */
async function seedUser(id: string, name: string): Promise<void> {
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
async function seedOrganization(
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
async function seedProject(
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
async function seedMilestone(
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

async function cleanup(): Promise<void> {
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

suite("tenant and project boundary", () => {
	beforeAll(async () => {
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
		await seedMilestone(
			ids.mHidden,
			ids.orgA,
			ids.pHiddenA,
			"Hidden milestone",
		);
		await seedMilestone(ids.mOrgB, ids.orgB, ids.pOrgB, "Org B milestone");
	});

	afterAll(async () => {
		await cleanup();
		await closeTenantDb();
		await closeRedis();
		await adminClient.end({ timeout: 5 });
	});

	describe("row level security", () => {
		test("an unscoped tenant read returns no rows", async () => {
			const rows = await getTenantDb().execute<{ id: string }>(
				sql`select id from "project"`,
			);

			expect(rows.length).toBe(0);
		});

		test("a scoped read only sees its own organization", async () => {
			const rows = await withTenant(
				{ organizationId: ids.orgA, userId: ids.ownerA },
				(tx) =>
					tx.execute<{ organization_id: string }>(
						sql`select organization_id from "project"`,
					),
			);

			expect(rows.length).toBeGreaterThan(0);
			expect(rows.every((row) => row.organization_id === ids.orgA)).toBe(true);
		});

		test("a cross tenant insert is rejected by Postgres", async () => {
			await expect(
				withTenant(
					{ organizationId: ids.orgA, userId: ids.ownerA },
					async (tx) => {
						await tx.insert(project).values({
							id: randomUUID(),
							organizationId: ids.orgB,
							name: "Intruder",
							slug: `intruder-${suffix}`,
						});
					},
				),
			).rejects.toThrow();
		});
	});

	describe("project visibility", () => {
		test("a member sees a project they belong to", async () => {
			const detail = await getProjectDetail(tenantMemberA(), ids.pVisibleA);

			expect(detail.project.id).toBe(ids.pVisibleA);
			expect(detail.viewer.projectRole).toBe("member");
			expect(detail.viewer.canEdit).toBe(false);
		});

		test("a member cannot see a project they do not belong to", async () => {
			await expect(
				getProjectDetail(tenantMemberA(), ids.pHiddenA),
			).rejects.toThrow(/no longer exists/);
		});

		test("an organization owner sees a project with no member rows", async () => {
			const detail = await getProjectDetail(tenantOwnerA(), ids.pOverlayA);

			expect(detail.project.id).toBe(ids.pOverlayA);
			expect(detail.viewer.projectRole).toBe("owner");
		});

		test("a member cannot see the overlay project", async () => {
			await expect(
				getProjectDetail(tenantMemberA(), ids.pOverlayA),
			).rejects.toThrow(/no longer exists/);
		});

		test("another organization cannot see the project", async () => {
			await expect(
				getProjectDetail(tenantOwnerB(), ids.pVisibleA),
			).rejects.toThrow(/no longer exists/);
		});

		test("the slug lookup obeys the same visibility rule", async () => {
			const visible = await getProjectDetailBySlug(
				tenantMemberA(),
				slug("visible-a"),
			);
			expect(visible.project.id).toBe(ids.pVisibleA);

			await expect(
				getProjectDetailBySlug(tenantMemberA(), slug("hidden-a")),
			).rejects.toThrow(/no longer exists/);
		});

		test("the list only contains projects the caller can see", async () => {
			const memberIds = (
				await listProjects(tenantMemberA(), projectQuery)
			).projects.map((row) => row.id);

			expect(memberIds).toContain(ids.pVisibleA);
			expect(memberIds).not.toContain(ids.pHiddenA);
			expect(memberIds).not.toContain(ids.pOverlayA);
			expect(memberIds).not.toContain(ids.pOrgB);

			const ownerIds = (
				await listProjects(tenantOwnerA(), projectQuery)
			).projects.map((row) => row.id);

			expect(ownerIds).toContain(ids.pVisibleA);
			expect(ownerIds).toContain(ids.pHiddenA);
			expect(ownerIds).toContain(ids.pOverlayA);
			expect(ownerIds).not.toContain(ids.pOrgB);
		});
	});

	describe("project writes", () => {
		test("a plain member cannot create a project", async () => {
			await expect(
				createProject(tenantMemberA(), {
					name: "Member project",
					slug: `member-project-${suffix}`,
				}),
			).rejects.toThrow(/owners and admins/);
		});

		test("an organization admin can create a project and owns it", async () => {
			const created = await createProject(tenantAdminA(), {
				name: "Admin project",
				slug: `admin-project-${suffix}`,
			});

			expect(created.viewer.projectRole).toBe("owner");
			expect(created.members.some((row) => row.userId === ids.adminA)).toBe(
				true,
			);

			await deleteProject(tenantAdminA(), created.project.id);
		});

		test("a client cannot edit the project", async () => {
			await expect(
				updateProject(tenantClientA(), ids.pVisibleA, { name: "Hijacked" }),
			).rejects.toThrow(/owners and admins/);
		});

		test("a project admin can edit the project", async () => {
			const updated = await updateProject(tenantAdminA(), ids.pVisibleA, {
				name: "Visible A renamed",
			});

			expect(updated.project.name).toBe("Visible A renamed");

			await updateProject(tenantAdminA(), ids.pVisibleA, {
				name: "Visible A",
			});
		});

		test("a plain member cannot delete the project", async () => {
			await expect(
				deleteProject(tenantMemberA(), ids.pVisibleA),
			).rejects.toThrow(/Only a project owner/);
		});

		test("a user from another organization cannot be added to a project", async () => {
			await expect(
				addProjectMember(
					tenantOwnerA(),
					ids.pVisibleA,
					ids.outsiderB,
					"member",
				),
			).rejects.toThrow(/no longer part of this organization/);
		});
	});

	describe("archiving", () => {
		test("a plain member cannot archive", async () => {
			await expect(
				setProjectArchived(tenantMemberA(), ids.pVisibleA, true),
			).rejects.toThrow(/owners and admins/);
		});

		test("archiving hides the project from members and clients, but not owners", async () => {
			await setProjectArchived(tenantAdminA(), ids.pVisibleA, true);

			await expect(
				getProjectDetail(tenantMemberA(), ids.pVisibleA),
			).rejects.toThrow(/no longer exists/);
			await expect(
				getProjectDetail(tenantClientA(), ids.pVisibleA),
			).rejects.toThrow(/no longer exists/);

			const ownerView = await getProjectDetail(tenantOwnerA(), ids.pVisibleA);
			expect(ownerView.viewer.locked).toBe(true);
		});

		test("opting in keeps the project visible to a client only", async () => {
			await setProjectArchiveVisibility(tenantAdminA(), ids.pVisibleA, true);

			const clientView = await getProjectDetail(tenantClientA(), ids.pVisibleA);
			expect(clientView.project.status).toBe("archived");

			await expect(
				getProjectDetail(tenantMemberA(), ids.pVisibleA),
			).rejects.toThrow(/no longer exists/);
		});

		test("an archived project rejects milestone and comment writes", async () => {
			await expect(
				updateMilestone(tenantAdminA(), ids.pVisibleA, ids.mVisible, {
					title: "Nope",
				}),
			).rejects.toThrow(/archived/);

			await expect(
				createMilestoneComment(tenantAdminA(), ids.pVisibleA, ids.mVisible, {
					body: paragraph("blocked"),
				}),
			).rejects.toThrow(/archived/);
		});

		test("restoring makes the project visible and writable again", async () => {
			await setProjectArchived(tenantAdminA(), ids.pVisibleA, false);

			const memberView = await getProjectDetail(tenantMemberA(), ids.pVisibleA);
			expect(memberView.viewer.locked).toBe(false);
		});
	});

	describe("milestones", () => {
		test("a member reads a milestone in a visible project", async () => {
			const detail = await getMilestone(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
			);

			expect(detail.milestone.id).toBe(ids.mVisible);
		});

		test("a milestone id from another project is not reachable", async () => {
			await expect(
				getMilestone(tenantMemberA(), ids.pHiddenA, ids.mVisible),
			).rejects.toThrow(/no longer exists/);
		});

		test("a milestone in another organization is not reachable", async () => {
			await expect(
				getMilestone(tenantOwnerB(), ids.pVisibleA, ids.mVisible),
			).rejects.toThrow(/no longer exists/);
		});

		test("a milestone cannot be reached through a sibling project the caller can see", async () => {
			// The organization owner can see both projects, so this is the real
			// id swap: the project is authorized, the milestone id is not its own.
			await expect(
				getMilestone(tenantOwnerA(), ids.pHiddenA, ids.mVisible),
			).rejects.toThrow(/no longer exists/);

			await expect(
				updateMilestone(tenantOwnerA(), ids.pHiddenA, ids.mVisible, {
					title: "Hijacked",
				}),
			).rejects.toThrow(/no longer exists/);

			await expect(
				deleteMilestone(tenantOwnerA(), ids.pHiddenA, ids.mVisible),
			).rejects.toThrow(/no longer exists/);
		});

		test("a client cannot create, edit or delete a milestone", async () => {
			await expect(
				createMilestone(tenantClientA(), ids.pVisibleA, {
					title: "Client milestone",
				}),
			).rejects.toThrow(/review milestones/);

			await expect(
				updateMilestone(tenantClientA(), ids.pVisibleA, ids.mVisible, {
					status: "done",
				}),
			).rejects.toThrow(/review milestones/);

			await expect(
				deleteMilestone(tenantClientA(), ids.pVisibleA, ids.mVisible),
			).rejects.toThrow(/review milestones/);
		});

		test("a member can create, edit and delete their own milestone", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Member milestone",
				status: "todo",
			});

			const updated = await updateMilestone(
				tenantMemberA(),
				ids.pVisibleA,
				created.milestone.id,
				{ status: "in_progress" },
			);
			expect(updated.milestone.status).toBe("in_progress");

			await deleteMilestone(
				tenantMemberA(),
				ids.pVisibleA,
				created.milestone.id,
			);
		});

		test("an assignee must belong to the project", async () => {
			await expect(
				setMilestoneAssignees(tenantMemberA(), ids.pVisibleA, ids.mVisible, [
					ids.outsiderB,
				]),
			).rejects.toThrow(/not on this project/);
		});

		test("a project member can be assigned", async () => {
			const result = await setMilestoneAssignees(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
				[ids.adminA],
			);

			expect(result.milestone.assignees.map((row) => row.userId)).toEqual([
				ids.adminA,
			]);
		});

		test("a date range with the start after the due date is rejected", async () => {
			await expect(
				updateMilestone(tenantMemberA(), ids.pVisibleA, ids.mVisible, {
					startDate: "2026-06-01",
					dueDate: "2026-05-01",
				}),
			).rejects.toThrow(/cannot be after/);
		});

		test("listing milestones obeys project visibility", async () => {
			const list = await listMilestones(
				tenantMemberA(),
				ids.pVisibleA,
				milestoneQuery,
			);
			expect(list.milestones.some((row) => row.id === ids.mVisible)).toBe(true);

			await expect(
				listMilestones(tenantMemberA(), ids.pHiddenA, milestoneQuery),
			).rejects.toThrow(/no longer exists/);
		});
	});

	describe("comments", () => {
		test("a client can post in the discussion", async () => {
			const created = await createMilestoneComment(
				tenantClientA(),
				ids.pVisibleA,
				ids.mVisible,
				{ body: paragraph("Client question") },
			);

			expect(bodyText(created.comment.body)).toBe("Client question");
		});

		test("only the author may edit or delete a comment", async () => {
			const created = await createMilestoneComment(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
				{ body: paragraph("Original") },
			);

			await expect(
				updateMilestoneComment(
					tenantAdminA(),
					ids.pVisibleA,
					ids.mVisible,
					created.comment.id,
					{ body: paragraph("Hijacked") },
				),
			).rejects.toThrow(/Only the person who wrote/);

			const edited = await updateMilestoneComment(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
				created.comment.id,
				{ body: paragraph("Edited") },
			);
			expect(bodyText(edited.comment.body)).toBe("Edited");

			await deleteMilestoneComment(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
				created.comment.id,
			);

			await expect(
				deleteMilestoneComment(
					tenantMemberA(),
					ids.pVisibleA,
					ids.mVisible,
					created.comment.id,
				),
			).rejects.toThrow(/deleted/);
		});

		test("a deleted root cannot receive a reply", async () => {
			const root = await createMilestoneComment(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
				{ body: paragraph("Will be deleted") },
			);

			await deleteMilestoneComment(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
				root.comment.id,
			);

			await expect(
				createMilestoneComment(tenantMemberA(), ids.pVisibleA, ids.mVisible, {
					body: paragraph("Reply"),
					parentId: root.comment.id,
				}),
			).rejects.toThrow(/deleted/);
		});

		test("a milestone id from another project cannot list comments", async () => {
			await expect(
				listMilestoneComments(tenantMemberA(), ids.pVisibleA, ids.mHidden, {
					cursor: null,
					limit: 20,
				}),
			).rejects.toThrow(/no longer exists/);
		});

		test("a thread cannot be reached through a sibling milestone", async () => {
			// Owner A can see both projects, so only the milestone scoping on the
			// comment query can stop this request.
			await expect(
				listMilestoneComments(tenantOwnerA(), ids.pHiddenA, ids.mVisible, {
					cursor: null,
					limit: 20,
				}),
			).rejects.toThrow(/no longer exists/);
		});

		test("another organization cannot read the discussion", async () => {
			await expect(
				listMilestoneComments(tenantOwnerB(), ids.pVisibleA, ids.mVisible, {
					cursor: null,
					limit: 20,
				}),
			).rejects.toThrow(/no longer exists/);
		});
	});
});
