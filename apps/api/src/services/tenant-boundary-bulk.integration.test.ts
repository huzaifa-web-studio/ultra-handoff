/**
 * Bulk project action checks.
 *
 * Why a separate file: the suite is split by scenario so each file stays
 * readable. The seed and helpers live in `tenant-boundary-fixtures.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { inArray } from "drizzle-orm";

import { adminDb } from "../db";
import { project } from "../db/schema";

import {
	bulkAddProjectMembers,
	bulkDeleteProjects,
	bulkRemoveProjectMembers,
	bulkSetProjectsArchived,
} from "./project";
import {
	bulkIds,
	cleanupTenantBoundaryFixture,
	ids,
	seedTenantBoundaryFixture,
	suite,
	tenantOwnerA,
} from "./tenant-boundary-fixtures";

suite("tenant boundary bulk", () => {
	beforeAll(seedTenantBoundaryFixture);
	afterAll(cleanupTenantBoundaryFixture);

	describe("bulk project actions", () => {
		test("archives a batch and skips a foreign project", async () => {
			const result = await bulkSetProjectsArchived(
				tenantOwnerA(),
				[...bulkIds, ids.pOrgB],
				true,
			);

			expect(
				result.results.filter((row) => row.status === "archived"),
			).toHaveLength(10);
			expect(result.results.find((row) => row.key === ids.pOrgB)?.status).toBe(
				"skipped",
			);

			const rows = await adminDb
				.select({ archivedAt: project.archivedAt })
				.from(project)
				.where(inArray(project.id, bulkIds));

			expect(rows.every((row) => row.archivedAt !== null)).toBe(true);
		});

		test("restores the same batch", async () => {
			const result = await bulkSetProjectsArchived(
				tenantOwnerA(),
				bulkIds,
				false,
			);

			expect(result.results.every((row) => row.status === "restored")).toBe(
				true,
			);
		});

		test("bulk add reports added and skipped per item", async () => {
			const result = await bulkAddProjectMembers(
				tenantOwnerA(),
				ids.pHiddenA,
				[ids.adminA, ids.memberA, ids.clientA, ids.outsiderB],
				"member",
			);

			expect(result.results.find((row) => row.key === ids.adminA)?.status).toBe(
				"added",
			);
			expect(
				result.results.find((row) => row.key === ids.memberA)?.status,
			).toBe("added");
			expect(
				result.results.find((row) => row.key === ids.clientA)?.status,
			).toBe("added");
			expect(
				result.results.find((row) => row.key === ids.outsiderB)?.status,
			).toBe("skipped");

			const again = await bulkAddProjectMembers(
				tenantOwnerA(),
				ids.pHiddenA,
				[ids.adminA, ids.memberA, ids.clientA],
				"member",
			);

			expect(again.results.every((row) => row.status === "skipped")).toBe(true);
		});

		test("bulk remove reports removed and skipped per item", async () => {
			const result = await bulkRemoveProjectMembers(
				tenantOwnerA(),
				ids.pHiddenA,
				[ids.memberA, ids.clientA, ids.outsiderB, ids.ownerA],
			);

			expect(
				result.results.find((row) => row.key === ids.memberA)?.status,
			).toBe("removed");
			expect(
				result.results.find((row) => row.key === ids.clientA)?.status,
			).toBe("removed");
			expect(
				result.results.find((row) => row.key === ids.outsiderB)?.status,
			).toBe("skipped");
			// Self removal is refused even inside a batch.
			expect(result.results.find((row) => row.key === ids.ownerA)?.status).toBe(
				"skipped",
			);
		});

		test("bulk delete removes the rows and reports missing ids", async () => {
			const result = await bulkDeleteProjects(tenantOwnerA(), [
				...bulkIds.slice(0, 2),
				"qa-bulk-missing",
			]);

			expect(
				result.results.filter((row) => row.status === "deleted"),
			).toHaveLength(2);
			expect(
				result.results.find((row) => row.key === "qa-bulk-missing")?.status,
			).toBe("skipped");

			const rows = await adminDb
				.select({ id: project.id })
				.from(project)
				.where(inArray(project.id, bulkIds.slice(0, 2)));

			expect(rows).toHaveLength(0);
		});
	});
});
