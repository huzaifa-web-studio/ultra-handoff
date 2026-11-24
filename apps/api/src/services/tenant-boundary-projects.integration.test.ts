/**
 * Project visibility, writes and archiving checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `tenant-boundary-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { project } from "../db/schema";
import { getTenantDb, withTenant } from "../db/tenant";

import { createMilestoneComment } from "./comment";

import { updateMilestone } from "./milestone";

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
} from "./project";
import {
	cleanupTenantBoundaryFixture,
	ids,
	paragraph,
	projectQuery,
	seedTenantBoundaryFixture,
	slug,
	suffix,
	suite,
	tenantAdminA,
	tenantClientA,
	tenantMemberA,
	tenantOwnerA,
	tenantOwnerB,
} from "./tenant-boundary-fixtures";

suite("tenant boundary projects", () => {
	beforeAll(seedTenantBoundaryFixture);
	afterAll(cleanupTenantBoundaryFixture);

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
});
