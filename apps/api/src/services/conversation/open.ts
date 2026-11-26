/**
 * Opening a conversation, reading its header and listing contacts.
 *
 * Why this file: "open a chat" has three shapes (create, resolve an existing
 * pair, read a header) that all depend on the same pair key and participant
 * rows. Keeping them together means the idempotency rule is stated once.
 *
 * Used by: `routes/conversations.ts`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, eq, inArray } from "drizzle-orm";

import { conversation, conversationParticipant } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { searchOrganizationMembers } from "../organization.service";
import {
	assertRecipientMember,
	loadPeople,
	pairKey,
	requireConversation,
} from "./access";
import { withTargetUser } from "./channels/shared";
import { buildConversationSummary, countConversationUnread } from "./list";
import type { ConversationContact, ConversationSummary } from "./types";

/** The header payload a conversation page needs. */
export type ConversationDetail = {
	conversation: ConversationSummary;
	counterpartRead: {
		lastReadAt: string | null;
		lastReadMessageId: string | null;
	} | null;
};

/**
 * Resolve the direct conversation with one person, creating it if needed.
 *
 * Why the insert has no `RETURNING`: the select policy requires a participant
 * row, and at insert time there is none. The row is inserted, both participant
 * rows are written, and only then is the conversation read back. The unique
 * pair index makes a concurrent second open land on the same row.
 */
export async function openDirectConversation(
	tenant: TenantContext,
	targetUserId: string,
): Promise<ConversationSummary> {
	const target = targetUserId.trim();

	if (target.length === 0) {
		throw new APIError("BAD_REQUEST", {
			message: "Choose a person to start a conversation with.",
		});
	}

	if (target === tenant.userId) {
		throw new APIError("BAD_REQUEST", {
			message: "You cannot start a conversation with yourself.",
		});
	}

	await assertRecipientMember(tenant.organizationId, target);

	const pair = pairKey(tenant.userId, target);

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await tx
				.insert(conversation)
				.values({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					scope: "direct",
					pairKey: pair,
					createdBy: tenant.userId,
				})
				.onConflictDoNothing();

			const [record] = await tx
				.select()
				.from(conversation)
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						eq(conversation.pairKey, pair),
					),
				)
				.limit(1);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That conversation could not be opened.",
				});
			}

			// The insert policy is self only, so the counterpart's row is written
			// with the transaction scoped to that person. Both inserts ignore a
			// conflict, because a concurrent open may have written the pair
			// already.
			await tx
				.insert(conversationParticipant)
				.values({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					conversationId: record.id,
					userId: tenant.userId,
					role: "owner",
				})
				.onConflictDoNothing();

			await withTargetUser(tx, target, () =>
				tx
					.insert(conversationParticipant)
					.values({
						id: randomUUID(),
						organizationId: tenant.organizationId,
						conversationId: record.id,
						userId: target,
						role: "member",
					})
					.onConflictDoNothing(),
			);

			const participants = await tx
				.select()
				.from(conversationParticipant)
				.where(
					and(
						eq(conversationParticipant.organizationId, tenant.organizationId),
						eq(conversationParticipant.conversationId, record.id),
					),
				);

			const people = await loadPeople(
				tenant.organizationId,
				participants.map((participant) => participant.userId),
			);
			const unread = await countConversationUnread(tx, tenant, record.id);

			return buildConversationSummary({
				record,
				participants,
				people,
				viewerId: tenant.userId,
				unread,
			});
		},
	);
}

/** Read one conversation the caller participates in. */
export async function getConversation(
	tenant: TenantContext,
	conversationId: string,
): Promise<ConversationDetail> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);
			const people = await loadPeople(
				tenant.organizationId,
				access.participants.map((participant) => participant.userId),
			);
			const unread = await countConversationUnread(tx, tenant, conversationId);

			return {
				conversation: buildConversationSummary({
					record: access.conversation,
					participants: access.participants,
					people,
					viewerId: tenant.userId,
					unread,
				}),
				counterpartRead: access.counterpart
					? {
							lastReadAt: access.counterpart.lastReadAt.toISOString(),
							lastReadMessageId: access.counterpart.lastReadMessageId,
						}
					: null,
			};
		},
	);
}

/**
 * Everyone the caller may start a conversation with.
 *
 * The product rule is the whole workspace: any member may chat with any other
 * member. The picker therefore searches organization members and annotates the
 * row with the conversation that already exists, so a click opens history
 * instead of a second empty chat.
 */
export async function listContacts(
	tenant: TenantContext,
	query: { search: string; limit: number },
): Promise<ConversationContact[]> {
	// One extra row tells the picker whether the search was cut.
	const members = await searchOrganizationMembers(
		tenant.organizationId,
		query.search,
		query.limit + 1,
	);
	const others = members
		.filter((member) => member.userId !== tenant.userId)
		.slice(0, query.limit);

	if (others.length === 0) return [];

	const pairs = others.map((member) => pairKey(tenant.userId, member.userId));

	const existing = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		(tx) =>
			tx
				.select({ id: conversation.id, pairKey: conversation.pairKey })
				.from(conversation)
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						inArray(conversation.pairKey, pairs),
					),
				),
	);

	const byPair = new Map(
		existing
			.filter((row) => row.pairKey !== null)
			.map((row) => [row.pairKey as string, row.id]),
	);

	return others.map((member) => ({
		userId: member.userId,
		name: member.name || member.email,
		image: member.image,
		role: member.role,
		conversationId: byPair.get(pairKey(tenant.userId, member.userId)) ?? null,
	}));
}
