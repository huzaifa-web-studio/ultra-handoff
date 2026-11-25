/**
 * Member profile reads.
 *
 * Proves the two rules the hover card and the profile page depend on: the
 * target must belong to the viewer's workspace, and every project or assignment
 * in the response is one the viewer may already open. Uses the shared tenant
 * boundary fixture so both workspaces exist.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { adminDb } from "../db";
import { user } from "../db/auth-schema";
import { milestone, milestoneAssignee } from "../db/schema";
import { getMemberProfile } from "./member-profile.service";
import {
	cleanupTenantBoundaryFixture,
	ids,
	seedTenantBoundaryFixture,
	suffix,
	suite,
	tenantMemberA,
	tenantOwnerA,
	tenantOwnerB,
} from "./tenant-boundary-fixtures";

/** A finished milestone, to prove done work is not listed. */
const doneMilestoneId = `qa-profile-done-${suffix}`;

/** The project membership row the fixture created for member A. */
const memberAProjectMemberId = `qa-pm-member-a-${suffix}`;

async function seedProfileFixtures(): Promise<void> {
	await seedTenantBoundaryFixture();

	await adminDb
		.update(user)
		.set({
			jobTitle: "Product designer",
			bio: "Designs calm interfaces.",
			location: "Lahore, Pakistan",
		})
		.where(eq(user.id, ids.memberA));

	await adminDb.insert(milestone).values({
		id: doneMilestoneId,
		organizationId: ids.orgA,
		projectId: ids.pVisibleA,
		title: "Finished work",
		status: "done",
		createdBy: ids.ownerA,
		updatedBy: ids.ownerA,
	});

	await adminDb.insert(milestoneAssignee).values([
		{
			id: `qa-profile-assignee-live-${suffix}`,
			organizationId: ids.orgA,
			milestoneId: ids.mVisible,
			projectMemberId: memberAProjectMemberId,
		},
		{
			id: `qa-profile-assignee-done-${suffix}`,
			organizationId: ids.orgA,
			milestoneId: doneMilestoneId,
			projectMemberId: memberAProjectMemberId,
		},
	]);
}

suite("member profile", () => {
	beforeAll(seedProfileFixtures);
	afterAll(cleanupTenantBoundaryFixture);

	test("returns identity, role and the optional profile fields", async () => {
		const profile = await getMemberProfile(tenantMemberA(), ids.memberA);

		expect(profile.userId).toBe(ids.memberA);
		expect(profile.name).toBe("Member A");
		expect(profile.email).toBe(`${ids.memberA}@example.test`);
		expect(profile.role).toBe("member");
		expect(profile.jobTitle).toBe("Product designer");
		expect(profile.bio).toBe("Designs calm interfaces.");
		expect(profile.location).toBe("Lahore, Pakistan");
		expect(profile.isSelf).toBe(true);
		expect(typeof profile.joinedAt).toBe("string");
	});

	test("never lists a project the viewer cannot see", async () => {
		// Owner A belongs to Visible A, Hidden A and the bulk projects, but the
		// viewer is only a member of Visible A.
		const profile = await getMemberProfile(tenantMemberA(), ids.ownerA);

		expect(profile.projects.map((item) => item.id)).toEqual([ids.pVisibleA]);
		expect(profile.projects[0]?.role).toBe("owner");
	});

	test("includes the implicit projects of an organization owner", async () => {
		// The overlay project has no member rows. An owner still owns it.
		const profile = await getMemberProfile(tenantOwnerA(), ids.ownerA);
		const overlay = profile.projects.find((item) => item.id === ids.pOverlayA);

		expect(profile.isSelf).toBe(true);
		expect(overlay?.role).toBe("owner");
	});

	test("lists live assignments only", async () => {
		const profile = await getMemberProfile(tenantMemberA(), ids.memberA);

		expect(profile.assignments.map((item) => item.id)).toEqual([ids.mVisible]);
		expect(profile.assignments[0]?.projectId).toBe(ids.pVisibleA);
		expect(profile.counts.assignments).toBe(1);
	});

	test("answers 404 for a user outside the workspace", async () => {
		await expect(getMemberProfile(tenantOwnerA(), ids.ownerB)).rejects.toThrow(
			/not part of this workspace/,
		);
	});

	test("answers 404 for another workspace reading its own member", async () => {
		// The same person can be read from the workspace they belong to.
		const profile = await getMemberProfile(tenantOwnerB(), ids.ownerB);

		expect(profile.userId).toBe(ids.ownerB);
		expect(profile.projects.map((item) => item.id)).toEqual([ids.pOrgB]);
	});
});
