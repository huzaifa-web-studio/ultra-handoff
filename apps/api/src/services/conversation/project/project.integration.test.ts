/**
 * Project room integration tests.
 *
 * Why these need Postgres: the room id is derived, participant rows are written
 * under RLS with a temporary scope switch, and the project archive mirror is a
 * database write. None of that can be proven with a pure unit test.
 *
 * The suite seeds its own workspace and project on the privileged client, runs
 * the services through the tenant role, and removes everything it created.
 *
 * Requires: `TEST_DATABASE=1`, an `app_test` database, migrations and bootstrap.
 * Used by: the API integration suite.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { adminDb } from "../../../db";
import { member, organization, user } from "../../../db/auth-schema";
import {
	conversation,
	conversationParticipant,
	project,
	projectMember,
} from "../../../db/schema";
import type { TenantContext } from "../../../middleware/tenant";
import { setProjectArchived } from "../../project/lifecycle";
import { removeProjectMember } from "../../project/members";
import { createConversationMessage } from "../create";
import { getConversation } from "../open";
import { deleteConversationMessage, editConversationMessage } from "../update";
import {
	getProjectConversationUnread,
	openProjectConversation,
	projectConversationId,
} from "./open";

const enabled =
	process.env.TEST_DATABASE === "1" &&
	(process.env.DATABASE_URL ?? "").includes("/app_test");

const suite = enabled ? describe : describe.skip;
const suffix = Date.now().toString(36);

const ids = {
	org: `qa-project-room-org-${suffix}`,
	owner: `qa-project-room-owner-${suffix}`,
	member: `qa-project-room-member-${suffix}`,
	outsider: `qa-project-room-outsider-${suffix}`,
	project: `qa-project-room-project-${suffix}`,
};

const people = [
	{ id: ids.owner, role: "owner" },
	{ id: ids.member, role: "member" },
	{ id: ids.outsider, role: "member" },
];

function tenant(userId: string): TenantContext {
	const person = people.find((entry) => entry.id === userId);

	return {
		organizationId: ids.org,
		userId,
		slug: `qa-${suffix}`,
		role: person?.role ?? "member",
		name: userId,
		memberId: `qa-project-room-member-${userId}`,
		memberCreatedAt: new Date(),
	};
}

suite("project conversation rooms", () => {
	beforeAll(async () => {
		await adminDb.insert(organization).values({
			id: ids.org,
			name: "QA Project Room Org",
			slug: `qa-project-room-${suffix}`,
			createdAt: new Date(),
		});

		for (const entry of people) {
			await adminDb.insert(user).values({
				id: entry.id,
				name: entry.id,
				email: `${entry.id}@example.test`,
				emailVerified: true,
			});
			await adminDb.insert(member).values({
				id: `qa-project-room-member-${entry.id}`,
				organizationId: ids.org,
				userId: entry.id,
				role: entry.role,
				createdAt: new Date(),
			});
		}

		await adminDb.insert(project).values({
			id: ids.project,
			organizationId: ids.org,
			name: "Project room",
			slug: `project-room-${suffix}`,
			createdBy: ids.owner,
		});

		await adminDb.insert(projectMember).values([
			{
				id: randomUUID(),
				organizationId: ids.org,
				projectId: ids.project,
				memberId: `qa-project-room-member-${ids.owner}`,
				userId: ids.owner,
				role: "owner",
			},
			{
				id: randomUUID(),
				organizationId: ids.org,
				projectId: ids.project,
				memberId: `qa-project-room-member-${ids.member}`,
				userId: ids.member,
				role: "member",
			},
		]);
	});

	afterAll(async () => {
		await adminDb.delete(organization).where(eq(organization.id, ids.org));
	});

	it("opens one idempotent room for the project members", async () => {
		const first = await openProjectConversation(tenant(ids.owner), ids.project);
		const second = await openProjectConversation(
			tenant(ids.owner),
			ids.project,
		);

		expect(first.conversation.id).toBe(projectConversationId(ids.project));
		expect(second.conversation.id).toBe(first.conversation.id);
		expect(first.conversation.scope).toBe("project");
		expect(first.conversation.memberCount).toBeGreaterThanOrEqual(2);
		expect(
			first.conversation.participants.map((row) => row.userId).sort(),
		).toEqual([ids.owner, ids.member].sort());

		const [row] = await adminDb
			.select()
			.from(conversation)
			.where(eq(conversation.projectId, ids.project));

		expect(row?.id).toBe(first.conversation.id);
	});

	it("answers 0 for a project the room has not seen any messages in", async () => {
		const unread = await getProjectConversationUnread(
			tenant(ids.member),
			ids.project,
		);

		expect(unread).toEqual({
			conversationId: projectConversationId(ids.project),
			unread: 0,
		});
	});

	it("keeps a non-member out of the room", async () => {
		await expect(
			openProjectConversation(tenant(ids.outsider), ids.project),
		).rejects.toThrow("no longer exists");
	});

	it("counts a new message for another participant", async () => {
		const result = await openProjectConversation(
			tenant(ids.owner),
			ids.project,
		);

		await createConversationMessage(tenant(ids.owner), result.conversation.id, {
			body: [{ type: "p", children: [{ text: "Project update" }] }],
			clientNonce: randomUUID(),
		});

		const unread = await getProjectConversationUnread(
			tenant(ids.member),
			ids.project,
		);

		expect(unread.unread).toBe(1);
	});

	it("revokes access when a project member is removed", async () => {
		await removeProjectMember(tenant(ids.owner), ids.project, ids.member);

		const [row] = await adminDb
			.select()
			.from(conversationParticipant)
			.where(
				and(
					eq(
						conversationParticipant.conversationId,
						projectConversationId(ids.project),
					),
					eq(conversationParticipant.userId, ids.member),
				),
			);

		expect(row?.leftAt).not.toBeNull();

		await expect(
			getConversation(tenant(ids.member), projectConversationId(ids.project)),
		).rejects.toThrow("no longer exists");
	});

	it("makes the room read only while the project is archived", async () => {
		const room = await openProjectConversation(tenant(ids.owner), ids.project);
		const sent = await createConversationMessage(
			tenant(ids.owner),
			room.conversation.id,
			{
				body: [{ type: "p", children: [{ text: "Before the archive" }] }],
				clientNonce: randomUUID(),
			},
		);

		await setProjectArchived(tenant(ids.owner), ids.project, true);

		await expect(
			createConversationMessage(tenant(ids.owner), room.conversation.id, {
				body: [{ type: "p", children: [{ text: "While archived" }] }],
				clientNonce: randomUUID(),
			}),
		).rejects.toThrow("This project is archived and is read only.");

		await expect(
			editConversationMessage(
				tenant(ids.owner),
				room.conversation.id,
				sent.message.id,
				{ body: [{ type: "p", children: [{ text: "Edited" }] }] },
			),
		).rejects.toThrow("This project is archived and is read only.");

		await expect(
			deleteConversationMessage(
				tenant(ids.owner),
				room.conversation.id,
				sent.message.id,
			),
		).rejects.toThrow("This project is archived and is read only.");

		const [row] = await adminDb
			.select({ archivedAt: conversation.archivedAt })
			.from(conversation)
			.where(eq(conversation.projectId, ids.project));

		expect(row?.archivedAt).not.toBeNull();
	});
});
