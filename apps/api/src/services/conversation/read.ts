/**
 * The read cursor.
 *
 * Why this file: opening a conversation marks it read, which is one monotonic
 * cursor move plus a bell clear. The cursor never moves backwards, so a stale
 * tab or a delayed request cannot resurrect an already read message as unread.
 *
 * The bell is only cleared when the cursor covers the newest message. Scrolling
 * halfway up and marking read must not clear a notification for a message the
 * person has not seen.
 *
 * Used by: `routes/conversations.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { conversationParticipant } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { loadMessageRecord, requireConversation } from "./access";
import { markDirectMessageNotificationRead } from "./notify";
import type { ConversationReadResult } from "./types";

/** True when the candidate position is after the stored cursor. */
function isAfterCursor(input: {
	createdAt: Date;
	id: string;
	cursorAt: Date;
	cursorId: string | null;
}): boolean {
	if (input.createdAt.getTime() > input.cursorAt.getTime()) return true;
	if (input.createdAt.getTime() < input.cursorAt.getTime()) return false;

	// Same millisecond: the id is the tiebreak, matching the page ordering.
	return input.cursorId === null || input.id > input.cursorId;
}

/** Move the viewer's read cursor to one message. */
export async function markConversationRead(
	tenant: TenantContext,
	conversationId: string,
	messageId: string,
): Promise<ConversationReadResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);
			const record = await loadMessageRecord(
				tx,
				tenant,
				conversationId,
				messageId,
			);

			if (!record) {
				throw new APIError("BAD_REQUEST", {
					message: "That message is not part of this conversation.",
				});
			}

			let lastReadAt = access.viewer.lastReadAt;
			let lastReadMessageId = access.viewer.lastReadMessageId;

			if (
				isAfterCursor({
					createdAt: record.createdAt,
					id: record.id,
					cursorAt: access.viewer.lastReadAt,
					cursorId: access.viewer.lastReadMessageId,
				})
			) {
				const [updated] = await tx
					.update(conversationParticipant)
					.set({
						lastReadAt: record.createdAt,
						lastReadMessageId: record.id,
					})
					.where(
						and(
							eq(conversationParticipant.organizationId, tenant.organizationId),
							eq(conversationParticipant.conversationId, conversationId),
							eq(conversationParticipant.userId, tenant.userId),
						),
					)
					.returning();

				if (updated) {
					lastReadAt = updated.lastReadAt;
					lastReadMessageId = updated.lastReadMessageId;
				}
			}

			/*
			 * Clear the bell only when the cursor covers the newest message. A
			 * partial scroll must not hide a notification for a message that is
			 * still below the fold.
			 */
			const newest = access.conversation.lastMessageAt;

			if (!newest || newest.getTime() <= lastReadAt.getTime()) {
				await markDirectMessageNotificationRead(tx, tenant, conversationId);
			}

			return {
				conversationId,
				lastReadAt: lastReadAt.toISOString(),
				lastReadMessageId: lastReadMessageId ?? "",
				unread: 0,
				participantIds: access.participants.map(
					(participant) => participant.userId,
				),
			};
		},
	);
}
