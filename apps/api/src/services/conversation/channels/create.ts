/**
 * Creating a group channel.
 *
 * Why this file: a channel is one conversation row plus one participant row per
 * member. The creator owns it, everyone else joins as a member, and the active
 * member count is recomputed from the rows that were just written.
 *
 * Access is limited to current workspace members. A public channel is
 * discoverable by the whole workspace, a private one only by its members.
 *
 * Used by: `routes/channels/`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { conversation, conversationParticipant } from "../../../db/schema";
import { withTenant } from "../../../db/tenant";
import { consumeRateLimit } from "../../../lib/rate-limit";
import type { TenantContext } from "../../../middleware/tenant";
import { loadPeople } from "../access";
import { buildConversationSummary } from "../list";
import type { ConversationSummary, CreateChannelInput } from "../types";
import {
	assertTitleAvailable,
	loadActiveParticipants,
	refreshMemberCount,
	withTargetUser,
} from "./shared";
import {
	assertWorkspaceMembers,
	isUniqueViolation,
	normalizeChannelDescription,
	normalizeChannelTitle,
	normalizeMemberIds,
	normalizeVisibility,
} from "./validate";

/** How many channels one person may create per minute. */
const CHANNEL_CREATE_LIMIT = 10;

/** One channel write result, with the people the route publishes to. */
export type ChannelResult = {
	conversation: ConversationSummary;
	participantIds: string[];
};

/**
 * Create a channel and add its first members.
 *
 * The duplicate name check runs before the insert for a friendly message, and
 * the partial unique index catches the concurrent case. Both produce the same
 * sentence so the browser never sees a driver error.
 */
export async function createChannel(
	tenant: TenantContext,
	input: CreateChannelInput,
): Promise<ChannelResult> {
	const title = normalizeChannelTitle(input.title);
	const description = normalizeChannelDescription(input.description);
	const visibility = normalizeVisibility(input.visibility);
	const memberIds = normalizeMemberIds(input.memberIds, tenant.userId);

	await assertWorkspaceMembers(tenant.organizationId, memberIds);

	const allowed = await consumeRateLimit(
		`channel-create:${tenant.userId}`,
		CHANNEL_CREATE_LIMIT,
		60,
	);

	if (!allowed) {
		throw new APIError("TOO_MANY_REQUESTS", {
			message: "You are creating channels too quickly. Wait a minute.",
		});
	}

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await assertTitleAvailable(tx, tenant.organizationId, title, visibility);

			const conversationId = randomUUID();

			try {
				await tx.insert(conversation).values({
					id: conversationId,
					organizationId: tenant.organizationId,
					scope: "group",
					title,
					description,
					visibility,
					createdBy: tenant.userId,
					memberCount: 0,
				});
			} catch (error) {
				if (isUniqueViolation(error, "conversation_org_group_title_idx")) {
					throw new APIError("BAD_REQUEST", {
						message: "A channel with that name already exists.",
					});
				}

				throw error;
			}

			// The creator writes their own row, then each member row is written
			// with the transaction scoped to that person. The participant insert
			// policy is self only, so this is the only way to add someone else.
			await tx.insert(conversationParticipant).values({
				id: randomUUID(),
				organizationId: tenant.organizationId,
				conversationId,
				userId: tenant.userId,
				role: "owner",
			});

			for (const userId of memberIds) {
				await withTargetUser(tx, userId, () =>
					tx.insert(conversationParticipant).values({
						id: randomUUID(),
						organizationId: tenant.organizationId,
						conversationId,
						userId,
						role: "member",
					}),
				);
			}

			await refreshMemberCount(tx, tenant.organizationId, conversationId);

			// The creator is a participant now, so the row is readable again.
			const [record] = await tx
				.select()
				.from(conversation)
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						eq(conversation.id, conversationId),
					),
				)
				.limit(1);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That channel could not be opened.",
				});
			}

			const participants = await loadActiveParticipants(
				tx,
				tenant.organizationId,
				conversationId,
			);
			const people = await loadPeople(
				tenant.organizationId,
				participants.map((participant) => participant.userId),
			);

			return {
				conversation: buildConversationSummary({
					record,
					participants,
					people,
					viewerId: tenant.userId,
					unread: 0,
				}),
				participantIds: participants.map((participant) => participant.userId),
			};
		},
	);
}
