/**
 * Realtime wiring for direct messages.
 *
 * One subscription at the messages layout patches the sidebar list, the main
 * timeline, every open thread and the unread badge. A message is routed by its
 * parent id: a root lands in the timeline, a reply lands in its thread and
 * increments the root's reply count.
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
import type { ConversationMessage, Message } from "./api";
import {
	appendMessage,
	appendThreadReply,
	type ConversationPages,
	type MessagePages,
	replaceRootMessage,
	replaceThreadReply,
	type ThreadPages,
	withConversationActivity,
	withCounterpartRead,
	withRootReplyCount,
	withThreadCounterpartRead,
	withThreadRead,
} from "./cache";
import {
	conversationMessagesKey,
	conversationsKey,
	conversationThreadKey,
} from "./keys";

/** Recompute the two capabilities the server strips before broadcasting. */
export function toViewerMessage(
	message: RealtimeConversationMessage,
	viewerId: string,
): ConversationMessage {
	const mine = message.author?.id === viewerId && message.deletedAt === null;

	return { ...message, canEdit: mine, canDelete: mine };
}

/** Add the reply summary a newly created root does not carry yet. */
function toRootView(message: ConversationMessage): Message {
	return { ...message, replyCount: 0, unreadReplyCount: 0 };
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
	if (record.threadRootId !== null && typeof record.threadRootId !== "string") {
		return null;
	}

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
 * `activeConversationId` and `activeThreadId` describe what is actually on
 * screen. A reply in a closed thread is unread even when the conversation pane
 * is open, and a root in the timeline is unread while a thread is open.
 */
export function useMessagesRealtime(input: {
	orgSlug: string;
	viewerId: string;
	activeConversationId: string | null;
	activeThreadId: string | null;
}): void {
	const queryClient = useQueryClient();
	const { orgSlug, viewerId, activeConversationId, activeThreadId } = input;

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

			if (read.threadRootId) {
				if (read.userId !== viewerId) {
					// The other person read this thread: show a receipt.
					queryClient.setQueryData<ThreadPages>(
						conversationThreadKey(
							orgSlug,
							read.conversationId,
							read.threadRootId,
						),
						(current) => withThreadCounterpartRead(current, cursor),
					);
				} else {
					// This person read it in another tab.
					queryClient.setQueryData<ThreadPages>(
						conversationThreadKey(
							orgSlug,
							read.conversationId,
							read.threadRootId,
						),
						(current) => withThreadRead(current, cursor),
					);
					queryClient.setQueryData<MessagePages>(
						conversationMessagesKey(orgSlug, read.conversationId),
						(current) =>
							withRootReplyCount(current, read.threadRootId as string, {
								clearUnread: true,
							}),
					);
					void queryClient.invalidateQueries({
						queryKey: notificationSummaryKey(orgSlug),
					});
				}

				return;
			}

			if (read.userId !== viewerId) {
				// The other person read the main timeline.
				queryClient.setQueryData<MessagePages>(
					conversationMessagesKey(orgSlug, read.conversationId),
					(current) => withCounterpartRead(current, cursor),
				);
			} else {
				// This person read the timeline in another tab.
				void queryClient.invalidateQueries({
					queryKey: conversationMessagesKey(orgSlug, read.conversationId),
				});
				void queryClient.invalidateQueries({
					queryKey: conversationsKey(orgSlug),
				});
				void queryClient.invalidateQueries({
					queryKey: notificationSummaryKey(orgSlug),
				});
			}

			return;
		}

		const payload = readMessageEvent(event);

		if (!payload) return;

		const message = toViewerMessage(payload.message, viewerId);
		const parentId = message.parentId;

		if (event.type === "conversation.message.created") {
			const visible =
				typeof document !== "undefined" &&
				document.visibilityState === "visible";
			const conversationActive =
				payload.conversationId === activeConversationId &&
				activeThreadId === null &&
				visible;
			const threadActive =
				payload.conversationId === activeConversationId &&
				parentId !== null &&
				activeThreadId === parentId &&
				visible;

			if (parentId) {
				queryClient.setQueryData<ThreadPages>(
					conversationThreadKey(orgSlug, payload.conversationId, parentId),
					(current) => appendThreadReply(current, message),
				);
				queryClient.setQueryData<MessagePages>(
					conversationMessagesKey(orgSlug, payload.conversationId),
					(current) =>
						withRootReplyCount(current, parentId, {
							replyDelta: 1,
							unreadDelta:
								payload.senderId !== viewerId && !threadActive ? 1 : 0,
						}),
				);
			} else {
				queryClient.setQueryData<MessagePages>(
					conversationMessagesKey(orgSlug, payload.conversationId),
					(current) => appendMessage(current, toRootView(message)),
				);
			}

			if (!payload.conversation) return;

			const current = queryClient.getQueryData<ConversationPages>(
				conversationsKey(orgSlug),
			);
			const result = withConversationActivity(current, payload.conversation, {
				viewerId,
				senderId: payload.senderId,
				active: parentId ? threadActive : conversationActive,
			});

			if (result.found) {
				queryClient.setQueryData(conversationsKey(orgSlug), result.pages);
			} else {
				// A brand new chat is not in the list yet.
				void queryClient.invalidateQueries({
					queryKey: conversationsKey(orgSlug),
				});
			}

			return;
		}

		if (parentId) {
			queryClient.setQueryData<ThreadPages>(
				conversationThreadKey(orgSlug, payload.conversationId, parentId),
				(current) => replaceThreadReply(current, message),
			);
		} else {
			queryClient.setQueryData<MessagePages>(
				conversationMessagesKey(orgSlug, payload.conversationId),
				(current) => replaceRootMessage(current, message),
			);
		}

		// An edit or a delete can change the sidebar preview.
		void queryClient.invalidateQueries({
			queryKey: conversationsKey(orgSlug),
		});
	});
}
