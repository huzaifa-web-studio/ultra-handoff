/**
 * Conversation realtime fan out.
 *
 * Why one helper: messages, read cursors, channel settings and membership all
 * publish to a set of people on the personal socket. Keeping the dedupe and the
 * fire and forget rule here means a route cannot accidentally await a Redis
 * publish or publish to the same person twice.
 *
 * A publish failure never fails the request: the transaction has already
 * committed and the stream is an accelerator, not the source of truth.
 *
 * Used by: `routes/conversations.ts` and `routes/channels/`.
 */

import { publishUserEvent } from "../../realtime";
import type { RealtimeEventType } from "../../realtime/protocol";

/** Publish one event to each distinct person. */
export function publishConversationToUsers(
	organizationId: string,
	userIds: string[],
	type: RealtimeEventType,
	data: unknown,
): void {
	for (const userId of new Set(userIds)) {
		void publishUserEvent(organizationId, userId, type, data).catch(
			() => undefined,
		);
	}
}
