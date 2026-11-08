/**
 * Project role, visibility and validation rules.
 *
 * Why these exist: the project list, detail, archive and member routes all
 * derive their answer from this module. A wrong predicate is a permission bug
 * that the UI cannot catch.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	assertProjectActive,
	assertProjectRole,
	assignableProjectRoles,
	canAssignProjectRole,
	canCreateProject,
	canDeleteProject,
	canEditProject,
	canManageProjectMembers,
	canManageProjectTarget,
	canViewArchivedProject,
	effectiveProjectRole,
	isProjectRole,
	PROJECT_ARCHIVED_MESSAGE,
	validateProjectDescription,
	validateProjectName,
	validateProjectSlug,
} from "./project-permissions";

describe("project role helpers", () => {
	test("recognises the four project roles", () => {
		for (const role of ["owner", "admin", "member", "client"]) {
			expect(isProjectRole(role)).toBe(true);
		}
		expect(isProjectRole("superuser")).toBe(false);
	});

	test("accepts a known role and rejects anything else", () => {
		expect(assertProjectRole("client")).toBe("client");
		expect(() => assertProjectRole("guest")).toThrow(/Unknown project role/);
	});
});

describe("validateProjectName", () => {
	test("trims and returns the name", () => {
		expect(validateProjectName("  Website redesign  ")).toBe(
			"Website redesign",
		);
	});

	test("rejects an empty name", () => {
		expect(() => validateProjectName("   ")).toThrow(/between 1 and 80/);
	});

	test("rejects a name over 80 characters", () => {
		expect(() => validateProjectName("a".repeat(81))).toThrow(
			/between 1 and 80/,
		);
	});
});

describe("validateProjectDescription", () => {
	test("turns a missing or empty description into null", () => {
		expect(validateProjectDescription(undefined)).toBeNull();
		expect(validateProjectDescription(null)).toBeNull();
		expect(validateProjectDescription("   ")).toBeNull();
	});

	test("trims a real description", () => {
		expect(validateProjectDescription("  Launch the new site  ")).toBe(
			"Launch the new site",
		);
	});

	test("rejects a description over 300 characters", () => {
		expect(() => validateProjectDescription("a".repeat(301))).toThrow(/300/);
	});
});

describe("validateProjectSlug", () => {
	test("accepts a readable slug", () => {
		expect(validateProjectSlug("website-redesign")).toBe("website-redesign");
	});

	test("rejects a slug outside the length range", () => {
		expect(() => validateProjectSlug("ab")).toThrow(/between 3 and 48/);
		expect(() => validateProjectSlug("a".repeat(49))).toThrow(
			/between 3 and 48/,
		);
	});

	test("rejects uppercase, underscores and boundary hyphens", () => {
		expect(() => validateProjectSlug("Website")).toThrow(/lowercase/);
		expect(() => validateProjectSlug("web_site")).toThrow(/lowercase/);
		expect(() => validateProjectSlug("website-")).toThrow(/lowercase/);
		expect(() => validateProjectSlug("-website")).toThrow(/lowercase/);
	});

	test("rejects a reserved control word", () => {
		expect(() => validateProjectSlug("settings")).toThrow(/reserved/);
		expect(() => validateProjectSlug("new")).toThrow(/reserved/);
	});

	test("rejects a surrounding space", () => {
		expect(() => validateProjectSlug(" website")).toThrow(/space/);
	});
});

describe("organization level project permissions", () => {
	test("owners and admins create projects", () => {
		expect(canCreateProject("owner")).toBe(true);
		expect(canCreateProject("admin")).toBe(true);
		expect(canCreateProject("member,admin")).toBe(true);
	});

	test("a plain member cannot create a project", () => {
		expect(canCreateProject("member")).toBe(false);
	});
});

describe("effectiveProjectRole", () => {
	test("an organization owner is always a project owner", () => {
		expect(effectiveProjectRole("owner", null)).toBe("owner");
		expect(effectiveProjectRole("owner", "client")).toBe("owner");
	});

	test("otherwise the project role applies", () => {
		expect(effectiveProjectRole("admin", "client")).toBe("client");
		expect(effectiveProjectRole("member", "admin")).toBe("admin");
	});

	test("no project row means no project role", () => {
		expect(effectiveProjectRole("member", null)).toBeNull();
		expect(effectiveProjectRole("member", "bogus")).toBeNull();
	});
});

describe("project write permissions", () => {
	test("owners and admins edit, owners delete", () => {
		expect(canEditProject("owner", null)).toBe(true);
		expect(canEditProject("admin", "admin")).toBe(true);
		expect(canEditProject("member", "admin")).toBe(true);
		expect(canEditProject("admin", "member")).toBe(false);
		expect(canEditProject("member", "member")).toBe(false);
		expect(canEditProject("member", "client")).toBe(false);

		expect(canDeleteProject("owner", null)).toBe(true);
		expect(canDeleteProject("member", "owner")).toBe(true);
		expect(canDeleteProject("admin", "admin")).toBe(false);
		expect(canDeleteProject("member", "client")).toBe(false);
	});

	test("member management follows edit permission", () => {
		expect(canManageProjectMembers("owner", null)).toBe(true);
		expect(canManageProjectMembers("admin", "admin")).toBe(true);
		expect(canManageProjectMembers("admin", "member")).toBe(false);
		expect(canManageProjectMembers("member", "member")).toBe(false);
	});
});

describe("archived project visibility", () => {
	test("owners and admins keep seeing an archived project", () => {
		expect(canViewArchivedProject("owner", false)).toBe(true);
		expect(canViewArchivedProject("admin", false)).toBe(true);
	});

	test("a client needs the project to opt in", () => {
		expect(canViewArchivedProject("client", false)).toBe(false);
		expect(canViewArchivedProject("client", true)).toBe(true);
	});

	test("a plain member never sees an archived project", () => {
		expect(canViewArchivedProject("member", true)).toBe(false);
	});
});

describe("assertProjectActive", () => {
	test("an active project passes", () => {
		expect(() => assertProjectActive(null)).not.toThrow();
	});

	test("an archived project is rejected with the shared message", () => {
		expect(() => assertProjectActive(new Date())).toThrow(
			PROJECT_ARCHIVED_MESSAGE,
		);
	});
});

describe("project member management", () => {
	test("an owner manages every role", () => {
		expect(canManageProjectTarget("owner", "owner")).toBe(true);
		expect(canManageProjectTarget("owner", "admin")).toBe(true);
		expect(canManageProjectTarget("owner", "member")).toBe(true);
		expect(canManageProjectTarget("owner", "client")).toBe(true);
	});

	test("an admin manages members and clients only", () => {
		expect(canManageProjectTarget("admin", "member")).toBe(true);
		expect(canManageProjectTarget("admin", "client")).toBe(true);
		expect(canManageProjectTarget("admin", "admin")).toBe(false);
		expect(canManageProjectTarget("admin", "owner")).toBe(false);
	});

	test("the predicate only inspects the target; the caller checks the actor first", () => {
		// The service calls canManageProjectMembers before this helper, so a
		// plain member never reaches it in a real request. The result below
		// describes the target role, not the actor's authority.
		expect(canManageProjectTarget("member", "client")).toBe(true);
		expect(canManageProjectTarget("member", "admin")).toBe(false);
	});
});

describe("assignable project roles", () => {
	test("an owner may assign all four roles", () => {
		expect(assignableProjectRoles("owner")).toEqual([
			"owner",
			"admin",
			"member",
			"client",
		]);
	});

	test("an admin may assign member and client only", () => {
		expect(assignableProjectRoles("admin")).toEqual(["member", "client"]);
		expect(canAssignProjectRole("admin", "owner")).toBe(false);
		expect(canAssignProjectRole("admin", "admin")).toBe(false);
		expect(canAssignProjectRole("admin", "client")).toBe(true);
	});
});
