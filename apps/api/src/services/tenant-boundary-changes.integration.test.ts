/**
 * Change request boundary checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `tenant-boundary-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
	createChangeRequest,
	listChangeRequests,
	moveChangeRequestToMilestone,
	updateChangeRequest,
} from "./change-request";

import {
	createMilestone,
	deleteMilestone,
	getMilestone,
	lockMilestone,
	unlockMilestone,
} from "./milestone";

import { setProjectArchived } from "./project";
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

suite("tenant boundary changes", () => {
	beforeAll(seedTenantBoundaryFixture);
	afterAll(cleanupTenantBoundaryFixture);

	describe("change requests", () => {
		test("a client can raise a request on a locked milestone", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Change request target",
			});
			const milestoneId = created.milestone.id;

			await lockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId, "Frozen");

			try {
				const result = await createChangeRequest(
					tenantClientA(),
					ids.pVisibleA,
					milestoneId,
					{ title: "Add a page", body: paragraph("Please add one") },
				);

				expect(result.changeRequest.status).toBe("open");
				expect(result.changeRequest.requestedBy?.id).toBe(ids.clientA);
				expect(result.openCount).toBe(1);

				const list = await listChangeRequests(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
				);

				expect(list.changeRequests).toHaveLength(1);
				expect(list.canDecide).toBe(true);
				expect(list.openCount).toBe(1);
			} finally {
				await unlockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("accept needs staff and works while locked", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Accept target",
			});
			const milestoneId = created.milestone.id;
			const request = await createChangeRequest(
				tenantClientA(),
				ids.pVisibleA,
				milestoneId,
				{ title: "Add a page" },
			);

			await lockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId, "Frozen");

			try {
				await expect(
					updateChangeRequest(
						tenantClientA(),
						ids.pVisibleA,
						milestoneId,
						request.changeRequest.id,
						{ status: "accepted" },
					),
				).rejects.toThrow(/Only staff/);

				// Accepting appends a named section and never rewrites the locked
				// initial scope, so the lock no longer blocks it.
				const accepted = await updateChangeRequest(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					request.changeRequest.id,
					{
						status: "accepted",
						note: "In scope",
						scopeTitle: "Contact page",
					},
				);

				expect(accepted.changeRequest.status).toBe("accepted");
				expect(accepted.changeRequest.decidedBy?.id).toBe(ids.memberA);
				expect(accepted.changeRequest.decisionNote).toBe("In scope");
				expect(accepted.openCount).toBe(0);
				expect(accepted.scopeEntry?.title).toBe("Contact page");
				expect(accepted.changeRequest.scopeEntryId).toBe(
					accepted.scopeEntry?.id ?? null,
				);

				const detail = await getMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
				);

				expect(detail.milestone.scopeEntries).toHaveLength(1);
				expect(detail.milestone.scopeEntries[0]?.kind).toBe("change");
			} finally {
				await unlockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("decline needs a reason and is final", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Decline target",
			});
			const milestoneId = created.milestone.id;
			const request = await createChangeRequest(
				tenantClientA(),
				ids.pVisibleA,
				milestoneId,
				{ title: "Add a page" },
			);

			try {
				await expect(
					updateChangeRequest(
						tenantMemberA(),
						ids.pVisibleA,
						milestoneId,
						request.changeRequest.id,
						{ status: "declined" },
					),
				).rejects.toThrow(/Say why/);

				const declined = await updateChangeRequest(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					request.changeRequest.id,
					{ status: "declined", note: "Out of scope" },
				);

				expect(declined.changeRequest.status).toBe("declined");
				expect(declined.changeRequest.decisionNote).toBe("Out of scope");

				await expect(
					updateChangeRequest(
						tenantClientA(),
						ids.pVisibleA,
						milestoneId,
						request.changeRequest.id,
						{ title: "Rewritten" },
					),
				).rejects.toThrow(/Only the person/);
			} finally {
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("the author can edit and withdraw while open, another member cannot", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Withdraw target",
			});
			const milestoneId = created.milestone.id;
			const request = await createChangeRequest(
				tenantClientA(),
				ids.pVisibleA,
				milestoneId,
				{ title: "Add a page", body: paragraph("Original") },
			);

			try {
				await expect(
					updateChangeRequest(
						tenantMemberA(),
						ids.pVisibleA,
						milestoneId,
						request.changeRequest.id,
						{ title: "Hijacked" },
					),
				).rejects.toThrow(/Only the person/);

				const edited = await updateChangeRequest(
					tenantClientA(),
					ids.pVisibleA,
					milestoneId,
					request.changeRequest.id,
					{ title: "Add a contact page", body: paragraph("Edited") },
				);

				expect(edited.changeRequest.title).toBe("Add a contact page");
				expect(bodyText(edited.changeRequest.body)).toBe("Edited");

				const withdrawn = await updateChangeRequest(
					tenantClientA(),
					ids.pVisibleA,
					milestoneId,
					request.changeRequest.id,
					{ status: "withdrawn" },
				);

				expect(withdrawn.changeRequest.status).toBe("withdrawn");
				expect(withdrawn.openCount).toBe(0);
			} finally {
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("moving a request creates a milestone and links it", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Move source",
			});
			const milestoneId = created.milestone.id;
			const request = await createChangeRequest(
				tenantClientA(),
				ids.pVisibleA,
				milestoneId,
				{ title: "Contact page", body: paragraph("New page") },
			);

			await lockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId, "Frozen");

			try {
				const moved = await moveChangeRequestToMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					request.changeRequest.id,
					{},
				);

				expect(moved.changeRequest.status).toBe("moved");
				expect(moved.changeRequest.targetMilestoneId).toBe(moved.milestone.id);
				expect(moved.changeRequest.targetMilestoneTitle).toBe("Contact page");
				expect(moved.milestone.title).toBe("Contact page");
				expect(bodyText(moved.milestone.description)).toBe("New page");

				// The source milestone is untouched: still locked, still the same
				// title and body.
				const source = await getMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
				);
				expect(source.milestone.lockedAt).not.toBeNull();
				expect(source.milestone.title).toBe("Move source");

				await deleteMilestone(
					tenantOwnerA(),
					ids.pVisibleA,
					moved.milestone.id,
				);
			} finally {
				await unlockMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("a request in another organization is not reachable", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Tenant target",
			});
			const milestoneId = created.milestone.id;
			const request = await createChangeRequest(
				tenantClientA(),
				ids.pVisibleA,
				milestoneId,
				{ title: "Add a page" },
			);

			try {
				await expect(
					createChangeRequest(tenantOwnerB(), ids.pVisibleA, milestoneId, {
						title: "Cross tenant",
					}),
				).rejects.toThrow(/no longer exists/);

				await expect(
					updateChangeRequest(
						tenantOwnerB(),
						ids.pVisibleA,
						milestoneId,
						request.changeRequest.id,
						{ status: "declined", note: "No" },
					),
				).rejects.toThrow(/no longer exists/);
			} finally {
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("an archived project refuses new change requests", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Archived target",
			});
			const milestoneId = created.milestone.id;

			await setProjectArchived(tenantOwnerA(), ids.pVisibleA, true);

			try {
				await expect(
					createChangeRequest(tenantAdminA(), ids.pVisibleA, milestoneId, {
						title: "Not now",
					}),
				).rejects.toThrow(/archived/);
			} finally {
				await setProjectArchived(tenantOwnerA(), ids.pVisibleA, false);
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});
	});
});
