/**
 * Message queries and mutations.
 *
 * Why react-query: the sidebar, the conversation header and the thread read the
 * same data, and a send, an edit or a read has to update all of them without a
 * full refetch. The reducers in `cache.ts` do the patching, so the mutation and
 * realtime paths cannot drift.
 *
 * Used by: every component in features/messages.
 */

import {
	type InfiniteData,
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { notificationSummaryKey } from "#/features/notifications/hooks";
import { ApiRequestError } from "#/lib/api";
import {
	type ConversationsPage,
	deleteMessage,
	editMessage,
	fetchContacts,
	fetchConversation,
	fetchConversations,
	fetchMessages,
	fetchMessagesAround,
	type MessagePage,
	markRead,
	openConversation,
	searchMessages,
	sendMessage,
} from "./api";
import {
	appendMessage,
	type ConversationActivity,
	type ConversationPages,
	type MessagePages,
	replaceMessage,
	withConversationActivity,
	withConversationUnread,
} from "./cache";
import {
	contactsKey,
	conversationKey,
	conversationMessagesKey,
	conversationSearchKey,
	conversationsKey,
} from "./keys";

/** A 403 or 404 is an answer, not a transient failure. */
function retryMessageQuery(failureCount: number, error: unknown): boolean {
	if (
		error instanceof ApiRequestError &&
		(error.status === 403 || error.status === 404)
	) {
		return false;
	}

	return failureCount < 2;
}

/** The sidebar and page list. */
export function useConversations(orgSlug: string) {
	return useInfiniteQuery({
		queryKey: conversationsKey(orgSlug),
		queryFn: ({ pageParam }) => fetchConversations(orgSlug, pageParam),
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: Boolean(orgSlug),
		staleTime: 20_000,
		retry: retryMessageQuery,
	});
}

/** One conversation header. */
export function useConversation(orgSlug: string, conversationId: string) {
	return useQuery({
		queryKey: conversationKey(orgSlug, conversationId),
		queryFn: () => fetchConversation(orgSlug, conversationId),
		enabled: Boolean(orgSlug) && Boolean(conversationId),
		staleTime: 20_000,
		retry: retryMessageQuery,
	});
}

/** One thread, paged by the before cursor. */
export function useMessages(orgSlug: string, conversationId: string) {
	return useInfiniteQuery({
		queryKey: conversationMessagesKey(orgSlug, conversationId),
		queryFn: ({ pageParam }) =>
			fetchMessages(orgSlug, conversationId, pageParam),
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: Boolean(orgSlug) && Boolean(conversationId),
		staleTime: 20_000,
		retry: retryMessageQuery,
	});
}

/** Resolve or create a direct conversation. */
export function useOpenConversation(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (userId: string) => openConversation(orgSlug, userId),
		onSuccess: (data) => {
			// The header is worth warming. The list only gains the row once the
			// conversation has a message.
			queryClient.setQueryData(conversationKey(orgSlug, data.conversation.id), {
				conversation: data.conversation,
				counterpartRead: null,
			});
		},
	});
}

/** Send a message and patch both caches. */
export function useSendMessage(
	orgSlug: string,
	conversationId: string,
	viewerId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: { body: unknown[]; clientNonce: string }) =>
			sendMessage(orgSlug, conversationId, input),
		onSuccess: (data) => {
			queryClient.setQueryData<MessagePages>(
				conversationMessagesKey(orgSlug, conversationId),
				(current) => appendMessage(current, data.message),
			);

			const activity: ConversationActivity = {
				id: conversationId,
				lastMessageAt: data.conversation.lastMessageAt,
				lastMessageId: data.conversation.lastMessageId,
				lastMessageAuthorId: data.conversation.lastMessageAuthorId,
				lastMessagePreview: data.conversation.lastMessagePreview,
			};

			const current = queryClient.getQueryData<ConversationPages>(
				conversationsKey(orgSlug),
			);
			const result = withConversationActivity(current, activity, {
				viewerId,
				senderId: viewerId,
				active: true,
			});

			if (result.found) {
				queryClient.setQueryData(conversationsKey(orgSlug), result.pages);
			} else {
				// A chat that was not in the list yet (its first message has just
				// arrived) needs one read to appear.
				void queryClient.invalidateQueries({
					queryKey: conversationsKey(orgSlug),
				});
			}
		},
	});
}

/** Change the body of your own message. */
export function useEditMessage(orgSlug: string, conversationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: { messageId: string; body: unknown[] }) =>
			editMessage(orgSlug, conversationId, input.messageId, input.body),
		onSuccess: (data) => {
			queryClient.setQueryData<MessagePages>(
				conversationMessagesKey(orgSlug, conversationId),
				(current) => replaceMessage(current, data.message),
			);
			// An edited message may be the sidebar preview.
			void queryClient.invalidateQueries({
				queryKey: conversationsKey(orgSlug),
			});
		},
	});
}

/** Soft delete your own message. */
export function useDeleteMessage(orgSlug: string, conversationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (messageId: string) =>
			deleteMessage(orgSlug, conversationId, messageId),
		onSuccess: (data) => {
			queryClient.setQueryData<MessagePages>(
				conversationMessagesKey(orgSlug, conversationId),
				(current) => replaceMessage(current, data.message),
			);
			void queryClient.invalidateQueries({
				queryKey: conversationsKey(orgSlug),
			});
		},
	});
}

/** Move the read cursor. The caller decides when it is worth sending. */
export function useMarkConversationRead(
	orgSlug: string,
	conversationId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (messageId: string) =>
			markRead(orgSlug, conversationId, messageId),
		onSuccess: () => {
			queryClient.setQueryData<ConversationPages>(
				conversationsKey(orgSlug),
				(current) => withConversationUnread(current, conversationId, 0),
			);

			// Reading clears this conversation's bell row.
			void queryClient.invalidateQueries({
				queryKey: notificationSummaryKey(orgSlug),
			});
			void queryClient.invalidateQueries({
				queryKey: ["organization", orgSlug, "notifications", "list"],
			});
		},
	});
}

/** In conversation search. One character is not a query. */
export function useMessageSearch(
	orgSlug: string,
	conversationId: string,
	search: string,
) {
	const term = search.trim();

	return useQuery({
		queryKey: conversationSearchKey(orgSlug, conversationId, term),
		queryFn: () => searchMessages(orgSlug, conversationId, term),
		enabled: term.length >= 2,
		staleTime: 30_000,
		retry: retryMessageQuery,
	});
}

/** Everyone the viewer can message. */
export function useContacts(orgSlug: string, search: string, enabled: boolean) {
	return useQuery({
		queryKey: contactsKey(orgSlug, search.trim()),
		queryFn: () => fetchContacts(orgSlug, search.trim()),
		enabled: Boolean(orgSlug) && enabled,
		staleTime: 30_000,
		placeholderData: keepPreviousData,
		retry: retryMessageQuery,
	});
}

/**
 * Load the page around one search hit.
 *
 * The thread cache is replaced by that single page, and its own cursor becomes
 * the "load older" continuation. The caller then scrolls to the hit and offers
 * a jump back to the newest page.
 */
export function useJumpToMessage(orgSlug: string, conversationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (messageId: string) =>
			fetchMessagesAround(orgSlug, conversationId, messageId),
		onSuccess: (page: MessagePage) => {
			queryClient.setQueryData<InfiniteData<MessagePage, string | null>>(
				conversationMessagesKey(orgSlug, conversationId),
				{ pages: [page], pageParams: [null] },
			);
		},
	});
}

/** Re-export the page types the components narrow against. */
export type { ConversationsPage, MessagePage };
