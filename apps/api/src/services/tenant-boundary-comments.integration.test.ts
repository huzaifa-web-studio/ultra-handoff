/**
 * Comment and invitation history checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `tenant-boundary-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { adminDb } from "../db";
import {
	createMilestoneComment,
	deleteMilestoneComment,
	listMilestoneComments,
	updateMilestoneComment,
} from "./comment";
import { listInvitationHistory } from "./invitation";

import {
	bodyText,
	cleanupTenantBoundaryFixture,
	ids,
	paragraph,
	seedTenantBoundaryFixture,
	suite,
	tenantAdminA,
	tenantClientA,
	tenantMemberA,
	tenantOwnerA,
	tenantOwnerB,
} from "./tenant-boundary-fixtures";

suite("tenant boundary comments", () => {
	beforeAll(seedTenantBoundaryFixture);
	afterAll(cleanupTenantBoundaryFixture);

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

		test("deleting a comment with an attachment still blanks the body", async () => {
			const created = await createMilestoneComment(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
				{
					body: [
						{
							type: "file",
							url: `/files/organizations/${ids.orgA}/comments/files/brief.pdf`,
							name: "brief.pdf",
							mime: "application/pdf",
							children: [{ text: "" }],
						},
					],
				},
			);

			const deleted = await deleteMilestoneComment(
				tenantMemberA(),
				ids.pVisibleA,
				ids.mVisible,
				created.comment.id,
			);

			// The body is gone and the delete did not fail on the attachment walk.
			expect(deleted.comment.body).toEqual([]);
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

		test("marks a comment author who left the workspace", async () => {
			const created = await createMilestoneComment(
				tenantClientA(),
				ids.pVisibleA,
				ids.mVisible,
				{ body: paragraph("Left behind") },
			);

			// The membership goes; the comment stays. The author id is on the
			// user row, so the read can still name the person but must not link
			// to a profile that now answers 404.
			await adminDb.execute(sql`delete from member where id = ${ids.mClientA}`);

			const result = await listMilestoneComments(
				tenantOwnerA(),
				ids.pVisibleA,
				ids.mVisible,
				{ cursor: null, limit: 20 },
			);
			const row = result.threads
				.flatMap((thread) => [thread.comment, ...thread.replies])
				.find((comment) => comment.id === created.comment.id);

			expect(row?.author?.isMember).toBe(false);
		});
	});

	describe("invitation history", () => {
		/** The status the seed data should derive, for count assertions. */
		function expectedInviteStatus(
			index: number,
		): "pending" | "expired" | "accepted" | "canceled" {
			if (index % 10 === 0) return "accepted";
			if (index % 17 === 0) return "canceled";
			return index % 3 === 0 ? "expired" : "pending";
		}

		function invitationQuery(
			overrides: Partial<Parameters<typeof listInvitationHistory>[1]> = {},
		): Parameters<typeof listInvitationHistory>[1] {
			return {
				status: "all",
				role: "all",
				search: "",
				page: 1,
				pageSize: 20,
				sort: "createdAt",
				direction: "desc",
				...overrides,
			};
		}

		test("paginates and counts 1000 invitations in SQL", async () => {
			const result = await listInvitationHistory(
				tenantOwnerA(),
				invitationQuery(),
			);

			expect(result.items).toHaveLength(20);
			expect(result.pagination.total).toBe(1000);
			expect(result.pagination.totalPages).toBe(50);
			expect(result.viewer.role).toBe("owner");

			const expected = {
				pending: 0,
				expired: 0,
				accepted: 0,
				canceled: 0,
				rejected: 0,
			};

			for (let index = 0; index < 1000; index += 1) {
				expected[expectedInviteStatus(index)] += 1;
			}

			expect(result.counts).toMatchObject({ ...expected, all: 1000 });
		});

		test("the status filter pages inside one bucket", async () => {
			const all = await listInvitationHistory(
				tenantOwnerA(),
				invitationQuery(),
			);
			const expired = await listInvitationHistory(
				tenantOwnerA(),
				invitationQuery({ status: "expired" }),
			);

			expect(expired.pagination.total).toBe(all.counts.expired);
			expect(expired.items.every((item) => item.status === "expired")).toBe(
				true,
			);
		});

		test("role and search narrow the scope and the counts", async () => {
			const admin = await listInvitationHistory(
				tenantOwnerA(),
				invitationQuery({ role: "admin" }),
			);

			expect(admin.pagination.total).toBe(200);
			expect(admin.counts.all).toBe(200);
			expect(admin.items.every((item) => item.role === "admin")).toBe(true);

			const search = await listInvitationHistory(
				tenantOwnerA(),
				invitationQuery({ search: "qa-invite-42@" }),
			);

			expect(search.pagination.total).toBe(1);
			expect(search.items[0]?.email).toBe("qa-invite-42@example.test");
		});

		test("sorts by email ascending", async () => {
			const result = await listInvitationHistory(
				tenantOwnerA(),
				invitationQuery({
					sort: "email",
					direction: "asc",
					pageSize: 10,
				}),
			);
			const emails = result.items.map((item) => item.email);

			expect(emails).toEqual([...emails].sort());
		});
	});
});
