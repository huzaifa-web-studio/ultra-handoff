/**
 * Unit tests for project room identity and role mapping.
 *
 * Why these are pure: the derived id and the role mapping are the two rules
 * the rest of the project room code assumes. They need no database.
 */

import { describe, expect, test } from "bun:test";

import { projectConversationId } from "./open";
import { toProjectConversationRole } from "./sync";

describe("projectConversationId", () => {
	test("is stable for one project and safe in a URL", () => {
		const projectId = "0f0f0f0f-1111-2222-3333-444444444444";
		const id = projectConversationId(projectId);

		expect(id).toBe(`project-${projectId}`);
		expect(id).toBe(projectConversationId(projectId));
		expect(id.length).toBeLessThanOrEqual(64);
		expect(encodeURIComponent(id)).toBe(id);
	});
});

describe("toProjectConversationRole", () => {
	test("owners and admins are room owners", () => {
		expect(toProjectConversationRole("owner")).toBe("owner");
		expect(toProjectConversationRole("admin")).toBe("owner");
		expect(toProjectConversationRole(null, true)).toBe("owner");
	});

	test("members and clients are plain room members", () => {
		expect(toProjectConversationRole("member")).toBe("member");
		expect(toProjectConversationRole("client")).toBe("member");
		expect(toProjectConversationRole(null)).toBe("member");
	});
});
