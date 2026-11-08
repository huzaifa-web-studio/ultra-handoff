/**
 * Milestone list reducer tests.
 *
 * The realtime path replaces a whole row with the broadcast summary. These
 * tests pin that a cleared field becomes null instead of keeping the old value,
 * and that removal only touches the matching id.
 */

import { describe, expect, it } from "bun:test";

import type { MilestoneSummary } from "./api";
import {
	type MilestonePages,
	patchMilestoneRow,
	removeMilestoneRow,
	setMilestoneStatusInPages,
} from "./cache";

/** One summary with the fields the list renders. */
function makeMilestone(
	overrides: Partial<MilestoneSummary> = {},
): MilestoneSummary {
	return {
		id: "milestone-1",
		projectId: "project-1",
		title: "Design",
		excerpt: "A first pass",
		status: "todo",
		startDate: "2026-01-01",
		dueDate: "2026-01-10",
		estimateMinutes: 60,
		assignees: [],
		completedAt: null,
		createdBy: "user-1",
		createdByName: "Ayesha",
		updatedBy: "user-1",
		updatedByName: "Ayesha",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

/** One response page with the given ids. */
function makePage(ids: string[], page = 1) {
	return {
		organizationId: "org-1",
		projectId: "project-1",
		milestones: ids.map((id) => makeMilestone({ id })),
		viewer: {
			userId: "user-1",
			canWrite: true,
			canComment: true,
			locked: false,
		},
		counts: {
			all: ids.length,
			active: ids.length,
			todo: ids.length,
			inProgress: 0,
			blocked: 0,
			done: 0,
			cancelled: 0,
		},
		page,
		pageSize: 25,
		total: ids.length,
		totalPages: 1,
	};
}

function makePages(ids: string[]): MilestonePages {
	return { pages: [makePage(ids)], pageParams: [1] };
}

describe("patchMilestoneRow", () => {
	it("replaces the matching row and leaves the others", () => {
		const pages = makePages(["a", "b"]);
		const next = patchMilestoneRow(
			pages,
			makeMilestone({ id: "b", title: "Build" }),
		);

		expect(next.pages[0]?.milestones[0]?.title).toBe("Design");
		expect(next.pages[0]?.milestones[1]?.title).toBe("Build");
	});

	it("replaces instead of merging, so a cleared date becomes null", () => {
		const pages = makePages(["a"]);
		const next = patchMilestoneRow(
			pages,
			makeMilestone({ id: "a", dueDate: null, estimateMinutes: null }),
		);
		const row = next.pages[0]?.milestones[0];

		expect(row?.dueDate).toBeNull();
		expect(row?.estimateMinutes).toBeNull();
	});

	it("updates the row across every loaded page", () => {
		const pages: MilestonePages = {
			pages: [makePage(["a"], 1), makePage(["b"], 2)],
			pageParams: [1, 2],
		};
		const next = patchMilestoneRow(
			pages,
			makeMilestone({ id: "a", status: "done" }),
		);

		expect(next.pages[0]?.milestones[0]?.status).toBe("done");
		expect(next.pages[1]?.milestones[0]?.id).toBe("b");
	});

	it("leaves counts and paging untouched", () => {
		const pages = makePages(["a"]);
		const next = patchMilestoneRow(
			pages,
			makeMilestone({ id: "a", title: "Build" }),
		);

		expect(next.pages[0]?.total).toBe(pages.pages[0]?.total);
		expect(next.pages[0]?.counts).toEqual(pages.pages[0]?.counts);
		expect(next.pageParams).toEqual(pages.pageParams);
	});
});

describe("removeMilestoneRow", () => {
	it("removes only the matching id", () => {
		const pages = makePages(["a", "b"]);
		const next = removeMilestoneRow(pages, "a");

		expect(next.pages[0]?.milestones.map((row) => row.id)).toEqual(["b"]);
	});

	it("removes the row from every loaded page", () => {
		const pages: MilestonePages = {
			pages: [makePage(["a", "b"], 1), makePage(["c"], 2)],
			pageParams: [1, 2],
		};
		const next = removeMilestoneRow(pages, "b");

		expect(next.pages[0]?.milestones.map((row) => row.id)).toEqual(["a"]);
		expect(next.pages[1]?.milestones.map((row) => row.id)).toEqual(["c"]);
	});

	it("is a no-op for an unknown id", () => {
		const pages = makePages(["a"]);
		const next = removeMilestoneRow(pages, "missing");

		expect(next.pages[0]?.milestones.map((row) => row.id)).toEqual(["a"]);
	});
});

describe("setMilestoneStatusInPages", () => {
	it("changes only the matching row's status", () => {
		const pages = makePages(["a", "b"]);
		const next = setMilestoneStatusInPages(pages, "b", "done");

		expect(next.pages[0]?.milestones[0]?.status).toBe("todo");
		expect(next.pages[0]?.milestones[1]?.status).toBe("done");
	});

	it("keeps every other field of the row", () => {
		const pages = makePages(["a"]);
		const before = pages.pages[0]?.milestones[0];
		const next = setMilestoneStatusInPages(pages, "a", "in_progress");
		const after = next.pages[0]?.milestones[0];

		expect(after).toEqual({ ...before, status: "in_progress" });
	});

	it("updates the row across every loaded page", () => {
		const pages: MilestonePages = {
			pages: [makePage(["a"], 1), makePage(["a"], 2)],
			pageParams: [1, 2],
		};
		const next = setMilestoneStatusInPages(pages, "a", "blocked");

		expect(next.pages[0]?.milestones[0]?.status).toBe("blocked");
		expect(next.pages[1]?.milestones[0]?.status).toBe("blocked");
	});

	it("is a no-op for an unknown id", () => {
		const pages = makePages(["a"]);
		const next = setMilestoneStatusInPages(pages, "missing", "done");

		expect(next.pages[0]?.milestones[0]?.status).toBe("todo");
	});
});
