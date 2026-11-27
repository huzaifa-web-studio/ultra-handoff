/**
 * Project room membership maintenance.
 *
 * Why this file: a project room is not managed by hand. Its participants are
 * the people the project Overview lists, so every project membership write has
 * to reconcile the room in the same transaction. Keeping the writes here means
 * the single and bulk member flows cannot drift apart.
 *
 * The participant insert and update policies are self only, which is the same
 * rule the channel code follows. A row for another person is therefore written
 * with the transaction briefly scoped to that person through `withTargetUser`.
 *
 * Used by: `services/conversation/project/open.ts` and the project member
 * modules.
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { conversation, conversationParticipant } from "../../../db/schema";
import type { TenantTx } from "../../../db/tenant";
import { withTargetUser } from "../channels/shared";

/** The conversation role a project member maps to. */
export type ProjectConversationRole = "owner" | "member";

/** One person and the role their project membership gives them. */
export type ProjectParticipantInput = {
	userId: string;
	role: ProjectConversationRole;
};

/** Find the room for one project, or null when it was never opened. */
export async function findProjectRoom(
	tx: TenantTx,
	organizationId: string,
	projectId: string,
): Promise<{ id: string; archivedAt: Date | null } | null> {
	const [row] = await tx
		.select({ id: conversation.id, archivedAt: conversation.archivedAt })
		.from(conversation)
		.where(
			and(
				eq(conversation.organizationId, organizationId),
				eq(conversation.projectId, projectId),
				eq(conversation.scope, "project"),
			),
		)
		.limit(1);

	return row ?? null;
}

/** Count the active participants, optionally excluding one person. */
export async function countActiveParticipants(
	tx: TenantTx,
	organizationId: string,
	conversationId: string,
	excludeUserId?: string,
): Promise<number> {
	const conditions = [
		eq(conversationParticipant.organizationId, organizationId),
		eq(conversationParticipant.conversationId, conversationId),
		isNull(conversationParticipant.leftAt),
	];

	if (excludeUserId) {
		conditions.push(ne(conversationParticipant.userId, excludeUserId));
	}

	const [row] = await tx
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(conversationParticipant)
		.where(and(...conditions));

	return row?.count ?? 0;
}

/**
 * Write the denormalised member count.
 *
 * `actorUserId` must be an active participant at the moment of the write,
 * because the conversation update policy is participant scoped. Add and remove
 * both call this while the target row is still active, so the actor is always
 * available.
 */
export async function writeMemberCount(
	tx: TenantTx,
	organizationId: string,
	conversationId: string,
	actorUserId: string,
	count: number,
): Promise<void> {
	await withTargetUser(tx, actorUserId, () =>
		tx
			.update(conversation)
			.set({ memberCount: count })
			.where(
				and(
					eq(conversation.organizationId, organizationId),
					eq(conversation.id, conversationId),
				),
			),
	);
}

/**
 * Insert or reactivate one participant.
 *
 * A reactivated row keeps its read cursor, so a person removed from the project
 * and added back sees the messages they missed instead of starting over. The
 * unique `(conversation_id, user_id)` index is the conflict target.
 */
export async function upsertProjectParticipant(
	tx: TenantTx,
	organizationId: string,
	conversationId: string,
	input: ProjectParticipantInput,
): Promise<void> {
	await withTargetUser(tx, input.userId, () =>
		tx
			.insert(conversationParticipant)
			.values({
				id: randomUUID(),
				organizationId,
				conversationId,
				userId: input.userId,
				role: input.role,
			})
			.onConflictDoUpdate({
				target: [
					conversationParticipant.conversationId,
					conversationParticipant.userId,
				],
				set: {
					leftAt: null,
					role: input.role,
					updatedAt: new Date(),
				},
			}),
	);
}

/**
 * Add one person to an existing room.
 *
 * Does nothing when the project never opened a room. The next open reconciles
 * every current member, so an early membership write does not need to create
 * the room itself.
 */
export async function addProjectParticipant(
	tx: TenantTx,
	organizationId: string,
	projectId: string,
	input: ProjectParticipantInput,
): Promise<void> {
	const room = await findProjectRoom(tx, organizationId, projectId);

	if (!room) return;

	await upsertProjectParticipant(tx, organizationId, room.id, input);

	const count = await countActiveParticipants(tx, organizationId, room.id);
	await writeMemberCount(tx, organizationId, room.id, input.userId, count);
}

/**
 * Revoke one person's access while keeping the row and its cursor.
 *
 * The count is written first, while the target is still active, because the
 * conversation update policy needs an active participant and the target is the
 * one scope we know is available.
 */
export async function removeProjectParticipant(
	tx: TenantTx,
	organizationId: string,
	projectId: string,
	userId: string,
): Promise<void> {
	const room = await findProjectRoom(tx, organizationId, projectId);

	if (!room) return;

	const remaining = await countActiveParticipants(
		tx,
		organizationId,
		room.id,
		userId,
	);

	await writeMemberCount(tx, organizationId, room.id, userId, remaining);

	await withTargetUser(tx, userId, () =>
		tx
			.update(conversationParticipant)
			.set({ leftAt: new Date() })
			.where(
				and(
					eq(conversationParticipant.organizationId, organizationId),
					eq(conversationParticipant.conversationId, room.id),
					eq(conversationParticipant.userId, userId),
					isNull(conversationParticipant.leftAt),
				),
			),
	);
}

/** Keep the room role aligned with the project role. */
export async function updateProjectParticipantRole(
	tx: TenantTx,
	organizationId: string,
	projectId: string,
	userId: string,
	role: ProjectConversationRole,
): Promise<void> {
	const room = await findProjectRoom(tx, organizationId, projectId);

	if (!room) return;

	await withTargetUser(tx, userId, () =>
		tx
			.update(conversationParticipant)
			.set({ role })
			.where(
				and(
					eq(conversationParticipant.organizationId, organizationId),
					eq(conversationParticipant.conversationId, room.id),
					eq(conversationParticipant.userId, userId),
				),
			),
	);
}

/**
 * Mirror a project archive or restore onto its room.
 *
 * The actor archiving a project may not participate in the room yet, so the
 * update borrows the scope of an active participant. When the room has no
 * active participant nobody can read it, and the next open reconciles the
 * archive state anyway.
 */
export async function setProjectRoomArchived(
	tx: TenantTx,
	organizationId: string,
	projectId: string,
	archivedAt: Date | null,
): Promise<void> {
	const room = await findProjectRoom(tx, organizationId, projectId);

	if (!room) return;

	const [actor] = await tx
		.select({ userId: conversationParticipant.userId })
		.from(conversationParticipant)
		.where(
			and(
				eq(conversationParticipant.organizationId, organizationId),
				eq(conversationParticipant.conversationId, room.id),
				isNull(conversationParticipant.leftAt),
			),
		)
		.limit(1);

	if (!actor) return;

	await withTargetUser(tx, actor.userId, () =>
		tx
			.update(conversation)
			.set({ archivedAt })
			.where(
				and(
					eq(conversation.organizationId, organizationId),
					eq(conversation.id, room.id),
				),
			),
	);
}

/**
 * Reconcile every participant in one room.
 *
 * Used by the open flow. Entries already deduplicated by the caller. Returns
 * the active count so the caller can write it under a scope it knows is active.
 */
export async function syncProjectParticipants(
	tx: TenantTx,
	organizationId: string,
	conversationId: string,
	entries: ProjectParticipantInput[],
): Promise<void> {
	for (const entry of entries) {
		await upsertProjectParticipant(tx, organizationId, conversationId, entry);
	}
}

/**
 * Map a project role onto a conversation role.
 *
 * Project rooms have no owner-only actions, so this is display consistency. It
 * keeps the roster readable if the same participant shape is ever rendered for
 * a project.
 */
export function toProjectConversationRole(
	projectRole: string | null | undefined,
	isOrganizationOwner = false,
): ProjectConversationRole {
	return isOrganizationOwner ||
		projectRole === "owner" ||
		projectRole === "admin"
		? "owner"
		: "member";
}
