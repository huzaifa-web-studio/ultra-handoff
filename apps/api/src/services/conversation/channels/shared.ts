/**
 * Channel database helpers.
 *
 * Why this file: create, membership and settings all need to recount active
 * members and prove a name is free. Keeping both here means the count is
 * recomputed from rows every time instead of being incremented, so it cannot
 * drift.
 *
 * Used by: `channels/create.ts`, `channels/membership.ts` and
 * `channels/settings.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq, isNull, ne, sql } from "drizzle-orm";

import { conversation, conversationParticipant } from "../../../db/schema";
import type { TenantTx } from "../../../db/tenant";
import type { TenantContext } from "../../../middleware/tenant";
import { loadPeople, requireConversation } from "../access";
import { buildConversationSummary, countConversationUnread } from "../list";
import type { ConversationSummary } from "../types";

/** One participant row as the database stores it. */
export type ParticipantRecord = typeof conversationParticipant.$inferSelect;

/**
 * Recompute the active member count for one channel.
 *
 * `excludeUserId` is used by leave: the actor is still active at the moment the
 * row is written, but the count must already exclude them. The conversation
 * update policy requires an active participant, so this runs before `left_at`
 * is set.
 */
export async function refreshMemberCount(
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

	const count = row?.count ?? 0;

	await tx
		.update(conversation)
		.set({ memberCount: count })
		.where(
			and(
				eq(conversation.organizationId, organizationId),
				eq(conversation.id, conversationId),
			),
		);

	return count;
}

/**
 * Run a statement with the transaction scoped to another person.
 *
 * Why: the participant update policy is self only, which keeps a read cursor
 * and a role from being changed on someone else's behalf. An owner removing or
 * promoting a member is the one legitimate cross-user write, so the service
 * proves ownership first and then borrows the target's scope for the single
 * update. The actor scope is always restored, including on failure.
 *
 * This is the same pattern the notification writer uses for a cross recipient
 * upsert.
 */
export async function withTargetUser<T>(
	tx: TenantTx,
	userId: string,
	fn: () => Promise<T>,
): Promise<T> {
	const [scopeRow] = await tx.execute<{ usr: string | null }>(
		sql`select current_setting('app.current_user_id', true) as usr`,
	);
	const original = scopeRow?.usr ?? "";

	try {
		await tx.execute(
			sql`select set_config('app.current_user_id', ${userId}, true)`,
		);

		return await fn();
	} finally {
		// A failed restore must not mask the original error.
		if (original) {
			await tx
				.execute(
					sql`select set_config('app.current_user_id', ${original}, true)`,
				)
				.catch(() => undefined);
		}
	}
}

/** Load the active members of one conversation. */
export async function loadActiveParticipants(
	tx: TenantTx,
	organizationId: string,
	conversationId: string,
): Promise<ParticipantRecord[]> {
	return tx
		.select()
		.from(conversationParticipant)
		.where(
			and(
				eq(conversationParticipant.organizationId, organizationId),
				eq(conversationParticipant.conversationId, conversationId),
				isNull(conversationParticipant.leftAt),
			),
		);
}

/**
 * Reject a channel name that is already taken in this workspace and visibility.
 *
 * Case insensitive, matching the partial unique index. Visibility is part of
 * the key so a public channel cannot reveal that a private channel already uses
 * a name. The index is still the concurrency guard; this check exists to answer
 * with a sentence instead of a driver error.
 */
export async function assertTitleAvailable(
	tx: TenantTx,
	organizationId: string,
	title: string,
	visibility: string,
	excludeConversationId?: string,
): Promise<void> {
	const conditions = [
		eq(conversation.organizationId, organizationId),
		eq(conversation.scope, "group"),
		eq(conversation.visibility, visibility),
		isNull(conversation.archivedAt),
		sql`lower(${conversation.title}) = lower(${title})`,
	];

	if (excludeConversationId) {
		conditions.push(ne(conversation.id, excludeConversationId));
	}

	const [existing] = await tx
		.select({ id: conversation.id })
		.from(conversation)
		.where(and(...conditions))
		.limit(1);

	if (existing) {
		throw new APIError("BAD_REQUEST", {
			message: "A channel with that name already exists.",
		});
	}
}

/** Count active owners, optionally excluding one person. */
export async function countActiveOwners(
	tx: TenantTx,
	organizationId: string,
	conversationId: string,
	excludeUserId?: string,
): Promise<number> {
	const conditions = [
		eq(conversationParticipant.organizationId, organizationId),
		eq(conversationParticipant.conversationId, conversationId),
		eq(conversationParticipant.role, "owner"),
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
 * Read one channel as the viewer sees it, with the people to fan out to.
 *
 * Shared by create, join and every settings mutation so those responses render
 * the same header the list does.
 */
export async function loadChannelSummary(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
): Promise<{ summary: ConversationSummary; participantIds: string[] }> {
	const access = await requireConversation(tx, tenant, conversationId);
	const people = await loadPeople(
		tenant.organizationId,
		access.participants.map((participant) => participant.userId),
	);
	const unread = await countConversationUnread(tx, tenant, conversationId);

	return {
		summary: buildConversationSummary({
			record: access.conversation,
			participants: access.participants,
			people,
			viewerId: tenant.userId,
			unread,
		}),
		participantIds: access.participants.map(
			(participant) => participant.userId,
		),
	};
}
