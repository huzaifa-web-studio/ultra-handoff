/**
 * Realtime wiring for direct messages.
 *
 * Why one subscription at the messages layout: the sidebar list, the open
 * thread and the unread badge all read the same feature. One handler patches
 * every cache, so a message sent from another device lands everywhere without a
 * refetch.
 *
 * Viewer rule: the server strips `canEdit` and `canDelete`, because they are
 * answers for the writer. They are recomputed here, exactly like comments.
 *
 * The stream is an accelerator, never the source of truth. A dropped frame is
 * recovered by the next read.
 *
 * Used by: the messages layout.
 */

import type {
	ConversationMessageRealtimePayload,
	ConversationReadPayload,
	RealtimeConversationMessage,
	RealtimeEnvelope,
} from "@org/api";
import { useQueryClient } from "@tanstack/react-query";

import { notificationSummaryKey } from "#/features/notifications/hooks";
import {
	clearTyping,
	conversationChannel,
	setTyping,
} from "#/lib/realtime/typing-store";
import { useUserRealtimeEvent } from "#/lib/realtime/user-events";
import type { Message } from "./api";
import {
	appendMessage,
	type ConversationPages,
	type MessagePages,
	replaceMessage,
	withConversationActivity,
	withConversationUnread,
	withCounterpartRead,
} from "./cache";
import {
	conversationKey,
	conversationMessagesKey,
	conversationsKey,
} from "./keys";

/** Recompute the two capabilities the server strips before broadcasting. */
export function toViewerMessage(
	message: RealtimeConversationMessage,
	viewerId: string,
): Message {
	const mine = message.author?.id === viewerId && message.deletedAt === null;

	return { ...message, canEdit: mine, canDelete: mine };
}

/** Validate one message event. */
export function readMessageEvent(
	event: RealtimeEnvelope,
): ConversationMessageRealtimePayload | null {
	if (
		event.type !== "conversation.message.created" &&
		event.type !== "conversation.message.updated" &&
		event.type !== "conversation.message.deleted"
	) {
		return null;
	}

	const data = event.data;

	if (!data || typeof data !== "object" || Array.isArray(data)) return null;

	const record = data as Record<string, unknown>;
	const message = record.message;
	const conversationId = record.conversationId;

	if (typeof conversationId !== "string") return null;
	if (!message || typeof message !== "object" || Array.isArray(message)) {
		return null;
	}

	const candidate = message as Record<string, unknown>;

	if (typeof candidate.id !== "string") return null;
	if (typeof candidate.createdAt !== "string") return null;

	return data as ConversationMessageRealtimePayload;
}

/** Validate one read event. */
export function readReadEvent(
	event: RealtimeEnvelope,
): ConversationReadPayload | null {
	if (event.type !== "conversation.read") return null;

	const data = event.data;

	if (!data || typeof data !== "object" || Array.isArray(data)) return null;

	const record = data as Record<string, unknown>;

	if (typeof record.conversationId !== "string") return null;
	if (typeof record.userId !== "string") return null;
	if (typeof record.lastReadAt !== "string") return null;
	if (typeof record.lastReadMessageId !== "string") return null;

	return data as ConversationReadPayload;
}

/** Validate one typing frame. A milestone frame carries no conversation id. */
function readTyping(
	event: RealtimeEnvelope,
): { conversationId: string; userId: string } | null {
	if (event.type !== "typing.started" && event.type !== "typing.stopped") {
		return null;
	}

	const data = event.data;

	if (!data || typeof data !== "object" || Array.isArray(data)) return null;

	const record = data as Record<string, unknown>;

	if (typeof record.conversationId !== "string") return null;
	if (typeof record.userId !== "string") return null;

	return {
		conversationId: record.conversationId,
		userId: record.userId,
	};
}

/**
 * Apply every personal message event to the caches.
 *
 * `activeConversationId` is the chat currently on screen. A message for that
 * chat does not bump its unread badge, and it does not raise an operating
 * system alert, because the reader is already looking at it.
 */
export function useMessagesRealtime(input: {
	orgSlug: string;
	viewerId: string;
	activeConversationId: string | null;
}): void {
	const queryClient = useQueryClient();
	const { orgSlug, viewerId, activeConversationId } = input;

	useUserRealtimeEvent((event) => {
		if (!orgSlug) return;

		const typing = readTyping(event);

		if (typing) {
			if (typing.userId === viewerId) return;

			const channel = conversationChannel(typing.conversationId);

			if (event.type === "typing.started") {
				setTyping(channel, typing.userId);
			} else {
				clearTyping(channel, typing.userId);
			}

			return;
		}

		const read = readReadEvent(event);

		if (read) {
			const cursor = {
				lastReadAt: read.lastReadAt,
				lastReadMessageId: read.lastReadMessageId,
			};

			if (read.userId !== viewerId) {
				// The other person read the chat: show their receipt.
				queryClient.setQueryData<MessagePages>(
					conversationMessagesKey(orgSlug, read.conversationId),
					(current) => withCounterpartRead(current, cursor),
				);
				queryClient.setQueryData(
					conversationKey(orgSlug, read.conversationId),
					(current: { counterpartRead: unknown } | undefined) =>
						current ? { ...current, counterpartRead: cursor } : current,
				);
			} else {
				// This person read it in another tab.
				queryClient.setQueryData<ConversationPages>(
					conversationsKey(orgSlug),
					(current) => withConversationUnread(current, read.conversationId, 0),
				);
				void queryClient.invalidateQueries({
					queryKey: notificationSummaryKey(orgSlug),
				});
			}

			return;
		}

		const payload = readMessageEvent(event);

		if (!payload) return;

		const message = toViewerMessage(payload.message, viewerId);

		queryClient.setQueryData<MessagePages>(
			conversationMessagesKey(orgSlug, payload.conversationId),
			(current) =>
				event.type === "conversation.message.created"
					? appendMessage(current, message)
					: replaceMessage(current, message),
		);

		if (event.type !== "conversation.message.created") {
			// An edit or a delete can change the sidebar preview.
			void queryClient.invalidateQueries({
				queryKey: conversationsKey(orgSlug),
			});

			return;
		}

		if (!payload.conversation) return;

		const active =
			payload.conversationId === activeConversationId &&
			typeof document !== "undefined" &&
			document.visibilityState === "visible";
		const current = queryClient.getQueryData<ConversationPages>(
			conversationsKey(orgSlug),
		);
		const result = withConversationActivity(current, payload.conversation, {
			viewerId,
			senderId: payload.senderId,
			active,
		});

		if (result.found) {
			queryClient.setQueryData(conversationsKey(orgSlug), result.pages);
		} else {
			// A brand new chat is not in the list yet.
			void queryClient.invalidateQueries({
				queryKey: conversationsKey(orgSlug),
			});
		}
	});
}
