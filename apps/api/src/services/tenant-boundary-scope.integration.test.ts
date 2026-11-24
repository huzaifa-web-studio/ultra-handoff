/**
 * Scope section boundary checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `tenant-boundary-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
	createMilestone,
	deleteMilestone,
	getMilestone,
	updateMilestone,
} from "./milestone";
import { updateMilestoneScopeEntry } from "./milestone/scope";
import {
	bodyText,
	cleanupTenantBoundaryFixture,
	ids,
	paragraph,
	seedTenantBoundaryFixture,
	suite,
	tenantClientA,
	tenantMemberA,
	tenantOwnerA,
} from "./tenant-boundary-fixtures";

suite("tenant boundary scope", () => {
	beforeAll(seedTenantBoundaryFixture);
	afterAll(cleanupTenantBoundaryFixture);

	describe("scope sections", () => {
		test("a test round is staff only and only while in testing", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Scope test",
				status: "in_testing",
			});
			const milestoneId = created.milestone.id;

			try {
				const detail = await getMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
				);
				const round = detail.milestone.scopeEntries.find(
					(entry) => entry.kind === "test",
				);

				expect(round).toBeDefined();
				expect(detail.milestone.phase.currentPeriodId).toBe(
					round?.statusPeriodId ?? null,
				);

				await expect(
					updateMilestoneScopeEntry(
						tenantClientA(),
						ids.pVisibleA,
						milestoneId,
						round?.id ?? "",
						{ body: paragraph("Client finding") },
					),
				).rejects.toThrow(/staff/);

				const saved = await updateMilestoneScopeEntry(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					round?.id ?? "",
					{ body: paragraph("Missing alt text") },
				);

				expect(bodyText(saved.body)).toBe("Missing alt text");

				await updateMilestone(tenantMemberA(), ids.pVisibleA, milestoneId, {
					status: "ready",
				});

				await expect(
					updateMilestoneScopeEntry(
						tenantMemberA(),
						ids.pVisibleA,
						milestoneId,
						round?.id ?? "",
						{ body: paragraph("Late finding") },
					),
				).rejects.toThrow(/testing|phase has ended/);
			} finally {
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("a review round is open to the client only in review", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Scope review",
				status: "in_review",
			});
			const milestoneId = created.milestone.id;

			try {
				const detail = await getMilestone(
					tenantClientA(),
					ids.pVisibleA,
					milestoneId,
				);
				const round = detail.milestone.scopeEntries.find(
					(entry) => entry.kind === "review",
				);

				expect(round).toBeDefined();

				const clientSaved = await updateMilestoneScopeEntry(
					tenantClientA(),
					ids.pVisibleA,
					milestoneId,
					round?.id ?? "",
					{ body: paragraph("Please tighten the spacing") },
				);

				expect(bodyText(clientSaved.body)).toBe("Please tighten the spacing");

				const memberSaved = await updateMilestoneScopeEntry(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					round?.id ?? "",
					{ body: paragraph("Agency note") },
				);

				expect(bodyText(memberSaved.body)).toBe("Agency note");

				await updateMilestone(tenantMemberA(), ids.pVisibleA, milestoneId, {
					status: "done",
				});

				await expect(
					updateMilestoneScopeEntry(
						tenantClientA(),
						ids.pVisibleA,
						milestoneId,
						round?.id ?? "",
						{ body: paragraph("Too late") },
					),
				).rejects.toThrow(/review/);
			} finally {
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("phase periods record every visit with one open row", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Phase history",
			});
			const milestoneId = created.milestone.id;

			try {
				await updateMilestone(tenantMemberA(), ids.pVisibleA, milestoneId, {
					status: "in_development",
				});
				await updateMilestone(tenantMemberA(), ids.pVisibleA, milestoneId, {
					status: "in_testing",
				});
				await updateMilestone(tenantMemberA(), ids.pVisibleA, milestoneId, {
					status: "ready",
				});

				const detail = await getMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
				);
				const open = detail.milestone.phase.periods.filter(
					(period) => period.exitedAt === null,
				);

				expect(detail.milestone.phase.periods.length).toBeGreaterThanOrEqual(4);
				expect(open).toHaveLength(1);
				expect(open[0]?.status).toBe("ready");
				expect(detail.milestone.phase.periods[0]?.exitedAt).not.toBeNull();
				expect(detail.milestone.phase.totals.in_testing).toBeGreaterThanOrEqual(
					0,
				);
			} finally {
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});

		test("cancelling keeps an optional reason on the status event", async () => {
			const created = await createMilestone(tenantMemberA(), ids.pVisibleA, {
				title: "Cancel reason",
			});
			const milestoneId = created.milestone.id;

			try {
				const result = await updateMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
					{ status: "cancelled", statusNote: "Client paused the project" },
				);

				expect(result.changed).toContain("status");
				expect(result.timeline[0]?.event.note).toBe(
					"Client paused the project",
				);

				const detail = await getMilestone(
					tenantMemberA(),
					ids.pVisibleA,
					milestoneId,
				);
				const last = detail.milestone.phase.periods.at(-1);

				expect(last?.status).toBe("cancelled");
				expect(last?.exitedAt).toBeNull();
				expect(last?.note).toBe("Client paused the project");
			} finally {
				await deleteMilestone(tenantOwnerA(), ids.pVisibleA, milestoneId);
			}
		});
	});
});
