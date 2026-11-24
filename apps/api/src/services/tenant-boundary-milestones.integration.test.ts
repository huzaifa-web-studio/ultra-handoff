/**
 * Milestone boundary and lifecycle checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `tenant-boundary-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createMilestoneComment, listMilestoneComments } from "./comment";

import {
	createMilestone,
	deleteMilestone,
	getMilestone,
	listMilestones,
	lockMilestone,
	setMilestoneAssignees,
	toggleMilestoneChecklist,
	unlockMilestone,
	updateMilestone,
} from "./milestone";

import {
	checklistBody,
	cleanupTenantBoundaryFixture,
	findChecklistItem,
	ids,
	milestoneQuery,
	paragraph,
	seedTenantBoundaryFixture,
	suite,
	tenantAdminA,
	tenantClientA,
	tenantMemberA,
	tenantOwnerA,
	tenantOwnerB,
} from "./tenant-boundary-fixtures";

suite("tenant boundary milestones", () => {
	beforeAll(seedTenantBoundaryFixture);
	afterAll(cleanupTenantBoundaryFixture);

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
				{ status: "in_development" },
			);
			expect(updated.milestone.status).toBe("in_development");

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

	describe("milestone lifecycle and lock", () => {
		test("a member moves through testing and review and back to development", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Lifecycle",
			});
			const milestoneId = created.milestone.id;

			try {
				for (const status of [
					"in_development",
					"in_testing",
					"in_review",
					"in_development",
					"in_review",
					"done",
				] as const) {
					const updated = await updateMilestone(
						tenantMemberA(),
						ids.pVisibleA,
						milestoneId,
						{ status },
					);

					expect(updated.milestone.status).toBe(status);
				}
			} finally {
				await deleteMilestone(tenantMemberA(), ids.pVisibleA, milestoneId);
			}
		});

		test("blocked needs a reason and records it on the timeline", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Blocked work",
			});
			const milestoneId = created.milestone.id;

			try {
				await expect(
					updateMilestone(tenantMemberA(), ids.pVisibleA, milestoneId, {
						status: "blocked",
					}),
				).rejects.toThrow(/Say why/);

				const blocked = await updateMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					{ status: "blocked", statusNote: "Waiting on the copy" },
				);

				expect(blocked.milestone.status).toBe("blocked");

				const timeline = await listMilestoneComments(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					{ cursor: null, limit: 20 },
				);
				const statusEvent = timeline.threads
					.map((thread) => thread.comment)
					.find(
						(comment) =>
							comment.event?.type === "status" &&
							comment.event.to === "blocked",
					);

				expect(statusEvent?.event?.note).toBe("Waiting on the copy");
			} finally {
				await deleteMilestone(tenantMemberA(), ids.pVisibleA, milestoneId);
			}
		});

		test("only an owner or admin can lock and unlock", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Locked work",
			});
			const milestoneId = created.milestone.id;

			try {
				await expect(
					lockMilestone(tenantMemberA(), ids.pVisibleA, milestoneId),
				).rejects.toThrow(/owner or admin/);

				const locked = await lockMilestone(
					tenantOwnerA(),
					ids.pVisibleA,
					milestoneId,
					"Scope agreed",
				);
				expect(locked.milestone.lockedAt).not.toBeNull();
				expect(locked.milestone.lockedByName).toBe("Owner A");

				await expect(
					lockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId),
				).rejects.toThrow(/already locked/);

				const unlocked = await unlockMilestone(
					tenantAdminA(),
					ids.pVisibleA,
					milestoneId,
					"New ask",
				);
				expect(unlocked.milestone.lockedAt).toBeNull();

				await expect(
					unlockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId),
				).rejects.toThrow(/not locked/);
			} finally {
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("a locked milestone keeps status and assignees open but refuses the document and delete", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Frozen work",
			});
			const milestoneId = created.milestone.id;

			await lockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId, "Frozen");

			try {
				await expect(
					updateMilestone(tenantMemberA(), ids.pVisibleA, milestoneId, {
						title: "Hijacked",
					}),
				).rejects.toThrow(/locked/);

				await expect(
					updateMilestone(tenantMemberA(), ids.pVisibleA, milestoneId, {
						startDate: "2026-01-01",
					}),
				).rejects.toThrow(/locked/);

				// Status changes are progress, not a change to the agreed text.
				const moved = await updateMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					{ status: "in_testing" },
				);
				expect(moved.milestone.status).toBe("in_testing");

				// Assignees follow the same rule.
				const assigned = await setMilestoneAssignees(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					[ids.adminA],
				);
				expect(assigned.milestone.assignees.map((row) => row.userId)).toEqual([
					ids.adminA,
				]);

				// The client still cannot touch either.
				await expect(
					updateMilestone(tenantClientA(), ids.pVisibleA, milestoneId, {
						status: "done",
					}),
				).rejects.toThrow(/review milestones/);

				await expect(
					deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId),
				).rejects.toThrow(/locked/);

				// Comments stay open while the milestone is locked.
				const comment = await createMilestoneComment(
					tenantClientA(),
					ids.pVisibleA,
					milestoneId,
					{ body: paragraph("Still talking") },
				);

				expect(comment.total).toBe(1);
			} finally {
				await unlockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("a checklist tick survives the lock for staff but not for the client", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Checklist work",
				description: checklistBody(),
			});
			const milestoneId = created.milestone.id;

			await lockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId, "Frozen");

			try {
				const item = findChecklistItem(created.milestone.description);

				expect(item).not.toBeNull();

				const ticked = await toggleMilestoneChecklist(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					{ itemId: item?.id ?? "", checked: true },
				);

				expect(findChecklistItem(ticked.milestone.description)?.checked).toBe(
					true,
				);

				await expect(
					toggleMilestoneChecklist(
						tenantClientA(),
						ids.pVisibleA,
						milestoneId,
						{
							itemId: item?.id ?? "",
							checked: false,
						},
					),
				).rejects.toThrow(/review milestones/);
			} finally {
				await unlockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});
	});
});
