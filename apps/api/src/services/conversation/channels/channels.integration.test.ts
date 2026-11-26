/**
 * Channel maintenance and visibility integration tests.
 *
 * Why: three of the release fixes cannot be proven by a pure unit test. They
 * depend on Postgres: the per visibility unique index, the restore collision,
 * the workspace removal detach, and the notification visibility predicate.
 *
 * The suite seeds its own workspace on the privileged client, runs the services
 * through the tenant role so RLS applies, and removes everything it created.
 *
 * Requires: `TEST_DATABASE=1`, an `app_test` database, migrations and bootstrap.
 * Used by: the API integration suite.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { detachWorkspaceMemberFromChannels } from "../../../auth/member-channels";
import { adminDb } from "../../../db";
import { member, organization, user } from "../../../db/auth-schema";
import {
	conversation,
	conversationParticipant,
	notification,
} from "../../../db/schema";
import { withTenant } from "../../../db/tenant";
import type { TenantContext } from "../../../middleware/tenant";
import { listNotifications } from "../../notification-query/list";
import { setChannelArchived, updateChannel } from "./index";

const enabled =
	process.env.TEST_DATABASE === "1" &&
	(process.env.DATABASE_URL ?? "").includes("/app_test");

const suite = enabled ? describe : describe.skip;
const suffix = Date.now().toString(36);

const ids = {
	org: `qa-channel-org-${suffix}`,
	owner: `qa-channel-owner-${suffix}`,
	member: `qa-channel-member-${suffix}`,
	outsider: `qa-channel-outsider-${suffix}`,
	leaver: `qa-channel-leaver-${suffix}`,
	archived: `qa-channel-archived-${suffix}`,
	reused: `qa-channel-reused-${suffix}`,
	shared: `qa-channel-shared-${suffix}`,
	detach: `qa-channel-detach-${suffix}`,
	empty: `qa-channel-empty-${suffix}`,
	notify: `qa-channel-notify-${suffix}`,
};

const users = [
	{ id: ids.owner, role: "owner" },
	{ id: ids.member, role: "member" },
	{ id: ids.outsider, role: "member" },
	{ id: ids.leaver, role: "member" },
];

function tenant(userId: string): TenantContext {
	return {
		organizationId: ids.org,
		userId,
		slug: `qa-${suffix}`,
		role: "member",
		name: userId,
		memberId: `qa-member-${userId}`,
		memberCreatedAt: new Date(),
	};
}

async function seedConversation(input: {
	id: string;
	title: string;
	visibility: "public" | "private";
	archived?: boolean;
	participants: { userId: string; role?: "owner" | "member" }[];
}): Promise<void> {
	await adminDb.insert(conversation).values({
		id: input.id,
		organizationId: ids.org,
		scope: "group",
		title: input.title,
		visibility: input.visibility,
		createdBy: ids.owner,
		memberCount: input.participants.length,
		archivedAt: input.archived ? new Date() : null,
	});

	await adminDb.insert(conversationParticipant).values(
		input.participants.map((participant) => ({
			id: randomUUID(),
			organizationId: ids.org,
			conversationId: input.id,
			userId: participant.userId,
			role: participant.role ?? "member",
		})),
	);
}

suite("channel maintenance", () => {
	beforeAll(async () => {
		await adminDb.insert(organization).values({
			id: ids.org,
			name: "QA Channel Org",
			slug: `qa-${suffix}`,
			createdAt: new Date(),
		});

		for (const entry of users) {
			await adminDb.insert(user).values({
				id: entry.id,
				name: entry.id,
				email: `${entry.id}@example.test`,
				emailVerified: true,
			});
			await adminDb.insert(member).values({
				id: `qa-member-${entry.id}`,
				organizationId: ids.org,
				userId: entry.id,
				role: entry.role,
				createdAt: new Date(),
			});
		}

		await seedConversation({
			id: ids.archived,
			title: "reused-name",
			visibility: "public",
			archived: true,
			participants: [{ userId: ids.owner, role: "owner" }],
		});
		await seedConversation({
			id: ids.reused,
			title: "reused-name",
			visibility: "public",
			participants: [{ userId: ids.owner, role: "owner" }],
		});
		await seedConversation({
			id: ids.shared,
			title: "shared-name",
			visibility: "private",
			participants: [{ userId: ids.owner, role: "owner" }],
		});
		await seedConversation({
			id: ids.detach,
			title: "detach-room",
			visibility: "public",
			participants: [
				{ userId: ids.leaver, role: "owner" },
				{ userId: ids.member, role: "member" },
			],
		});
		await seedConversation({
			id: ids.empty,
			title: "empty-room",
			visibility: "public",
			participants: [{ userId: ids.leaver, role: "owner" }],
		});
		await seedConversation({
			id: ids.notify,
			title: "notify-room",
			visibility: "public",
			participants: [{ userId: ids.owner, role: "owner" }],
		});

		await adminDb.insert(notification).values({
			id: randomUUID(),
			organizationId: ids.org,
			recipientUserId: ids.member,
			actorUserId: ids.owner,
			type: "group_message",
			dedupeKey: `channel:${ids.notify}`,
			conversationId: ids.notify,
			data: { preview: "hello", threadRootId: null },
		});
	});

	afterAll(async () => {
		await adminDb.delete(organization).where(eq(organization.id, ids.org));
	});

	it("restoring over a reused name answers a friendly error, not a 500", async () => {
		await expect(
			setChannelArchived(tenant(ids.owner), ids.archived, false),
		).rejects.toThrow("already exists");
	});

	it("allows a public and a private channel to share a name", async () => {
		const result = await updateChannel(tenant(ids.owner), ids.reused, {
			title: "shared-name",
			visibility: "public",
		});

		expect(result.conversation.title).toBe("shared-name");
	});

	it("refuses to move a channel into a visibility where the name is taken", async () => {
		await expect(
			updateChannel(tenant(ids.owner), ids.reused, {
				visibility: "private",
			}),
		).rejects.toThrow("already exists");
	});

	it("detaches a removed workspace member and keeps an owner", async () => {
		await detachWorkspaceMemberFromChannels(ids.org, ids.leaver);

		const rows = await adminDb
			.select()
			.from(conversationParticipant)
			.where(
				and(
					eq(conversationParticipant.organizationId, ids.org),
					eq(conversationParticipant.userId, ids.leaver),
				),
			);

		expect(rows.every((row) => row.leftAt !== null)).toBe(true);

		const [room] = await adminDb
			.select()
			.from(conversation)
			.where(eq(conversation.id, ids.detach));
		const [ownerRow] = await adminDb
			.select()
			.from(conversationParticipant)
			.where(
				and(
					eq(conversationParticipant.conversationId, ids.detach),
					eq(conversationParticipant.userId, ids.member),
				),
			);

		expect(room?.memberCount).toBe(1);
		expect(ownerRow?.role).toBe("owner");
	});

	it("archives a channel that nobody is left in", async () => {
		const [room] = await adminDb
			.select()
			.from(conversation)
			.where(eq(conversation.id, ids.empty));

		expect(room?.memberCount).toBe(0);
		expect(room?.archivedAt).not.toBeNull();
	});

	it("hides a channel notification once the recipient leaves", async () => {
		await adminDb.insert(conversationParticipant).values({
			id: randomUUID(),
			organizationId: ids.org,
			conversationId: ids.notify,
			userId: ids.member,
			role: "member",
		});

		const before = await listNotifications(tenant(ids.member), {
			cursor: null,
			limit: 10,
			filter: "all",
		});

		expect(
			before.notifications.some((row) => row.conversationId === ids.notify),
		).toBe(true);

		await adminDb
			.update(conversationParticipant)
			.set({ leftAt: new Date() })
			.where(
				and(
					eq(conversationParticipant.conversationId, ids.notify),
					eq(conversationParticipant.userId, ids.member),
				),
			);

		const after = await listNotifications(tenant(ids.member), {
			cursor: null,
			limit: 10,
			filter: "all",
		});

		expect(
			after.notifications.some((row) => row.conversationId === ids.notify),
		).toBe(false);
	});

	it("does not let a non-owner write another person's participant row", async () => {
		await expect(
			withTenant({ organizationId: ids.org, userId: ids.outsider }, (tx) =>
				tx.insert(conversationParticipant).values({
					id: randomUUID(),
					organizationId: ids.org,
					conversationId: ids.notify,
					userId: ids.leaver,
					role: "owner",
				}),
			),
		).rejects.toThrow();
	});
});
