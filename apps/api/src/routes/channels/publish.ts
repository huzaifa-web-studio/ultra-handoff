/**
 * Channel realtime publishing.
 *
 * Why a small module: create, settings and membership all announce the same two
 * events. A channel change is metadata, so the payload is the id and the client
 * refetches the list and the header. The message body never travels here.
 *
 * Used by: `routes/channels/`.
 */

import type {
	ConversationMemberChangedPayload,
	ConversationUpdatedPayload,
} from "../../realtime/events";
import { publishConversationToUsers } from "../../services/conversation/publish";

/** Tell every active participant that the channel metadata changed. */
export function publishConversationUpdated(
	organizationId: string,
	participantIds: string[],
	conversationId: string,
): void {
	publishConversationToUsers(
		organizationId,
		participantIds,
		"conversation.updated",
		{ conversationId } satisfies ConversationUpdatedPayload,
	);
}

/** Tell one person they were added to or removed from a channel. */
export function publishMemberChanged(
	organizationId: string,
	userId: string,
	conversationId: string,
	action: "added" | "removed",
): void {
	publishConversationToUsers(
		organizationId,
		[userId],
		"conversation.member.changed",
		{
			conversationId,
			userId,
			action,
		} satisfies ConversationMemberChangedPayload,
	);
}
