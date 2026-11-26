/**
 * Read cursors.
 *
 * The conversation cursor covers roots in the main timeline. A thread cursor
 * covers one root and its replies. Opening the conversation therefore never
 * marks a thread read, which is what keeps "new replies" meaningful.
 *
 * Both paths use the exact timestamp helpers in `cursors.ts`; a JavaScript Date
 * round-trip would truncate microseconds and leave a message unread.
 *
 * The bell row is per conversation, so it is cleared only when the conversation
 * has no unread roots and no unread replies left.
 *
 * Used by: `routes/conversations.ts`.
 */

import { APIError } from "better-auth/api";
import type { TenantTx } from "../../db/tenant";
import { withTenant } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { loadMessageRecord, requireConversation } from "./access";
import { advanceConversationCursor, advanceThreadCursor } from "./cursors";
import { countConversationUnread } from "./list";
import { markDirectMessageNotificationRead } from "./notify";
import type { ConversationReadResult } from "./types";

/**
 * Count unread after a cursor move and clear the bell when nothing is left.
 *
 * A conversation can still have unread replies after its roots are read, so the
 * bell is cleared on the same condition the badge uses.
 */
async function unreadAfterRead(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
): Promise<number> {
	const unread = await countConversationUnread(tx, tenant, conversationId);

	if (unread === 0) {
		await markDirectMessageNotificationRead(tx, tenant, conversationId);
	}

	return unread;
}

/** Move the conversation cursor to one root message. */
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

			if (record.parentId !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "Open the thread to mark a reply read.",
				});
			}

			const cursor = await advanceConversationCursor(
				tx,
				tenant,
				conversationId,
				record.id,
			);
			const unread = await unreadAfterRead(tx, tenant, conversationId);

			return {
				conversationId,
				threadRootId: null,
				lastReadAt: cursor.lastReadAt.toISOString(),
				lastReadMessageId: cursor.lastReadMessageId ?? "",
				unread,
				participantIds: access.participants.map(
					(participant) => participant.userId,
				),
			};
		},
	);
}

/** Move one thread cursor to one message in that thread. */
export async function markThreadRead(
	tenant: TenantContext,
	conversationId: string,
	rootId: string,
	messageId: string,
): Promise<ConversationReadResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);
			const root = await loadMessageRecord(tx, tenant, conversationId, rootId);

			if (!root || root.parentId !== null) {
				throw new APIError("NOT_FOUND", {
					message: "That thread no longer exists.",
				});
			}

			const record = await loadMessageRecord(
				tx,
				tenant,
				conversationId,
				messageId,
			);

			// The cursor may only move to the root itself or one of its replies.
			if (!record || (record.id !== rootId && record.parentId !== rootId)) {
				throw new APIError("BAD_REQUEST", {
					message: "That message is not part of this thread.",
				});
			}

			const cursor = await advanceThreadCursor(
				tx,
				tenant,
				conversationId,
				rootId,
				record.id,
			);
			const unread = await unreadAfterRead(tx, tenant, conversationId);

			return {
				conversationId,
				threadRootId: rootId,
				lastReadAt: cursor.lastReadAt.toISOString(),
				lastReadMessageId: cursor.lastReadMessageId ?? "",
				unread,
				participantIds: access.participants.map(
					(participant) => participant.userId,
				),
			};
		},
	);
}
