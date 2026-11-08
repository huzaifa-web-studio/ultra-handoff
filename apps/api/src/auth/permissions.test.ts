/**
 * Organization role, slug and name rules.
 *
 * Why these exist: every member, invitation and settings route depends on the
 * same small set of predicates. They are pure, so a regression here is cheap to
 * catch and expensive to find by clicking through the UI.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import {
	assertAllowedRoles,
	assignableInvitationRoles,
	canEditOrganization,
	canManageMembers,
	canManageOwners,
	canManageTarget,
	isOrganizationOwner,
	parseRoleList,
	validateOrganizationName,
	validateOrganizationSlug,
} from "./permissions";

describe("parseRoleList", () => {
	test("splits a comma separated role string", () => {
		expect(parseRoleList("owner,admin")).toEqual(["owner", "admin"]);
	});

	test("trims each part and drops empties", () => {
		expect(parseRoleList([" owner , admin ", " ", "member"])).toEqual([
			"owner",
			"admin",
			"member",
		]);
	});

	test("returns an empty list for an empty value", () => {
		expect(parseRoleList("")).toEqual([]);
		expect(parseRoleList(" , ")).toEqual([]);
	});
});

describe("organization role predicates", () => {
	test("only owner and admin may edit the organization", () => {
		expect(canEditOrganization("owner")).toBe(true);
		expect(canEditOrganization("admin")).toBe(true);
		expect(canEditOrganization("member")).toBe(false);
	});

	test("a multi role value is understood", () => {
		expect(canEditOrganization("member,admin")).toBe(true);
		expect(isOrganizationOwner("admin,owner")).toBe(true);
		expect(isOrganizationOwner("admin")).toBe(false);
	});

	test("member management follows the settings role", () => {
		expect(canManageMembers("owner")).toBe(true);
		expect(canManageMembers("admin")).toBe(true);
		expect(canManageMembers("member")).toBe(false);
	});

	test("only an owner manages owners", () => {
		expect(canManageOwners("owner")).toBe(true);
		expect(canManageOwners("admin")).toBe(false);
	});
});

describe("canManageTarget", () => {
	test("an owner manages anyone", () => {
		expect(canManageTarget("owner", "owner")).toBe(true);
		expect(canManageTarget("owner", "admin")).toBe(true);
		expect(canManageTarget("owner", "member")).toBe(true);
	});

	test("an admin manages plain members only", () => {
		expect(canManageTarget("admin", "member")).toBe(true);
		expect(canManageTarget("admin", "admin")).toBe(false);
		expect(canManageTarget("admin", "owner")).toBe(false);
	});

	test("a multi role target is only manageable when every part is member", () => {
		expect(canManageTarget("admin", "member,admin")).toBe(false);
		expect(canManageTarget("admin", "member,member")).toBe(true);
	});

	test("the predicate only inspects the target; the caller checks the actor first", () => {
		// The service always calls canManageMembers / assertManager before this
		// helper, so a plain member never reaches it in a real request. As a
		// standalone predicate it answers "is this target a plain member", which
		// is why the actor check cannot be inferred from this result.
		expect(canManageTarget("member", "member")).toBe(true);
		expect(canManageTarget("member", "admin")).toBe(false);
	});
});

describe("assignableInvitationRoles", () => {
	test("an owner may invite an admin", () => {
		expect(assignableInvitationRoles("owner")).toEqual(["member", "admin"]);
	});

	test("an admin may invite members only", () => {
		expect(assignableInvitationRoles("admin")).toEqual(["member"]);
	});

	test("owner is never offered through an invitation", () => {
		for (const role of ["owner", "admin", "member"]) {
			expect(assignableInvitationRoles(role)).not.toContain("owner");
		}
	});
});

describe("assertAllowedRoles", () => {
	test("accepts every known role", () => {
		expect(() => assertAllowedRoles("owner")).not.toThrow();
		expect(() => assertAllowedRoles("admin")).not.toThrow();
		expect(() => assertAllowedRoles("member")).not.toThrow();
		expect(() => assertAllowedRoles("member,admin")).not.toThrow();
	});

	test("rejects an unknown role", () => {
		expect(() => assertAllowedRoles("superuser")).toThrow(/Unknown role/);
		expect(() => assertAllowedRoles("member,root")).toThrow(/Unknown role/);
	});
});

describe("validateOrganizationSlug", () => {
	test("accepts a lowercase hyphenated slug", () => {
		expect(validateOrganizationSlug("acme")).toBe("acme");
		expect(validateOrganizationSlug("acme-studio-2")).toBe("acme-studio-2");
	});

	test("rejects a slug outside the length range", () => {
		expect(() => validateOrganizationSlug("ab")).toThrow(/between 3 and 48/);
		expect(() => validateOrganizationSlug("a".repeat(49))).toThrow(
			/between 3 and 48/,
		);
	});

	test("rejects uppercase, underscores and double hyphens", () => {
		expect(() => validateOrganizationSlug("Acme")).toThrow(/lowercase/);
		expect(() => validateOrganizationSlug("acme_co")).toThrow(/lowercase/);
		expect(() => validateOrganizationSlug("acme--co")).toThrow(/lowercase/);
		expect(() => validateOrganizationSlug("-acme")).toThrow(/lowercase/);
		expect(() => validateOrganizationSlug("acme-")).toThrow(/lowercase/);
	});

	test("rejects a surrounding space instead of trimming it", () => {
		expect(() => validateOrganizationSlug(" acme")).toThrow(/space/);
		expect(() => validateOrganizationSlug("acme ")).toThrow(/space/);
	});

	test("rejects a reserved slug", () => {
		expect(() => validateOrganizationSlug("account")).toThrow(/reserved/);
		expect(() => validateOrganizationSlug("invite")).toThrow(/reserved/);
	});
});

describe("validateOrganizationName", () => {
	test("trims and returns the name", () => {
		expect(validateOrganizationName("  Acme Studio  ")).toBe("Acme Studio");
	});

	test("rejects an empty or whitespace only name", () => {
		expect(() => validateOrganizationName("")).toThrow(/1 and 64/);
		expect(() => validateOrganizationName("   ")).toThrow(/1 and 64/);
	});

	test("rejects a name longer than 64 characters", () => {
		expect(() => validateOrganizationName("a".repeat(65))).toThrow(/1 and 64/);
	});
});
