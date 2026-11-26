/**
 * Message queries and mutations.
 *
 * The main timeline and a focused thread are separate caches. A send, an edit,
 * a delete and a read all patch the cache they belong to, and the main timeline
 * is told when a reply count changes. The reducers in `cache.ts` do the
 * patching, so the mutation and realtime paths cannot drift.
 *
 * Used by: every component in features/messages.
 */

import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { notificationSummaryKey } from "#/features/notifications/hooks";
import { ApiRequestError } from "#/lib/api";
import {
	type ConversationMessage,
	type ConversationsPage,
	deleteMessage,
	editMessage,
	fetchContacts,
	fetchConversation,
	fetchConversations,
	fetchMessages,
	fetchMessagesAround,
	fetchThread,
	type Message,
	type MessagePage,
	markRead,
	markThreadRead,
	openConversation,
	searchMessages,
	sendMessage,
	type ThreadPage,
} from "./api";
import {
	appendMessage,
	appendThreadReply,
	type ConversationActivity,
	type ConversationPages,
	type MessagePages,
	replaceRootMessage,
	replaceThreadReply,
	type ThreadPages,
	withConversationActivity,
	withConversationUnread,
	withRootReplyCount,
	withThreadRead,
} from "./cache";
import {
	contactsKey,
	conversationKey,
	conversationMessagesKey,
	conversationSearchKey,
	conversationsKey,
	conversationThreadKey,
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

/** Add the reply summary a newly created root does not carry yet. */
function toRootView(message: ConversationMessage): Message {
	return { ...message, replyCount: 0, unreadReplyCount: 0 };
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

/** One main timeline of root messages. */
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

/** One focused thread, paged by the before cursor. */
export function useThread(
	orgSlug: string,
	conversationId: string,
	rootId: string,
) {
	return useInfiniteQuery({
		queryKey: conversationThreadKey(orgSlug, conversationId, rootId),
		queryFn: ({ pageParam }) =>
			fetchThread(
				orgSlug,
				conversationId,
				rootId,
				pageParam ? { before: pageParam } : undefined,
			),
		initialPageParam: null as string | null,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		enabled: Boolean(orgSlug) && Boolean(conversationId) && Boolean(rootId),
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
			queryClient.setQueryData(conversationKey(orgSlug, data.conversation.id), {
				conversation: data.conversation,
				counterpartRead: null,
			});
		},
	});
}

/** Send a root message or a reply. */
export function useSendMessage(
	orgSlug: string,
	conversationId: string,
	viewerId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: {
			body: unknown[];
			clientNonce: string;
			parentId?: string | null;
		}) => sendMessage(orgSlug, conversationId, input),
		onSuccess: (data) => {
			const parentId = data.message.parentId;

			if (parentId) {
				queryClient.setQueryData<ThreadPages>(
					conversationThreadKey(orgSlug, conversationId, parentId),
					(current) => appendThreadReply(current, data.message),
				);

				/*
				 * The server is the authority for the root reply count.
				 *
				 * Bumping it here as well as in the realtime echo counted the
				 * author's own reply twice. One refetch corrects the root and
				 * keeps the inline thread open.
				 */
				void queryClient.invalidateQueries({
					queryKey: conversationMessagesKey(orgSlug, conversationId),
				});
			} else {
				queryClient.setQueryData<MessagePages>(
					conversationMessagesKey(orgSlug, conversationId),
					(current) => appendMessage(current, toRootView(data.message)),
				);
			}

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
			if (data.message.parentId) {
				queryClient.setQueryData<ThreadPages>(
					conversationThreadKey(orgSlug, conversationId, data.message.parentId),
					(current) => replaceThreadReply(current, data.message),
				);
			} else {
				queryClient.setQueryData<MessagePages>(
					conversationMessagesKey(orgSlug, conversationId),
					(current) => replaceRootMessage(current, data.message),
				);
			}

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
			if (data.message.parentId) {
				queryClient.setQueryData<ThreadPages>(
					conversationThreadKey(orgSlug, conversationId, data.message.parentId),
					(current) => replaceThreadReply(current, data.message),
				);
			} else {
				queryClient.setQueryData<MessagePages>(
					conversationMessagesKey(orgSlug, conversationId),
					(current) => replaceRootMessage(current, data.message),
				);
			}

			void queryClient.invalidateQueries({
				queryKey: conversationsKey(orgSlug),
			});
		},
	});
}

/** Move the conversation cursor. */
export function useMarkConversationRead(
	orgSlug: string,
	conversationId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (messageId: string) =>
			markRead(orgSlug, conversationId, messageId),
		onSuccess: (data) => {
			// The response unread still includes unread replies in other threads,
			// so it is used verbatim instead of assuming zero.
			queryClient.setQueryData<ConversationPages>(
				conversationsKey(orgSlug),
				(current) =>
					withConversationUnread(current, conversationId, data.unread),
			);

			void queryClient.invalidateQueries({
				queryKey: notificationSummaryKey(orgSlug),
			});
			void queryClient.invalidateQueries({
				queryKey: ["organization", orgSlug, "notifications", "list"],
			});
		},
	});
}

/** Move one thread cursor. */
export function useMarkThreadRead(
	orgSlug: string,
	conversationId: string,
	rootId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (messageId: string) =>
			markThreadRead(orgSlug, conversationId, rootId, messageId),
		onSuccess: (data) => {
			queryClient.setQueryData<ThreadPages>(
				conversationThreadKey(orgSlug, conversationId, rootId),
				(current) =>
					withThreadRead(current, {
						lastReadAt: data.lastReadAt,
						lastReadMessageId: data.lastReadMessageId,
					}),
			);
			queryClient.setQueryData<MessagePages>(
				conversationMessagesKey(orgSlug, conversationId),
				(current) => withRootReplyCount(current, rootId, { clearUnread: true }),
			);
			queryClient.setQueryData<ConversationPages>(
				conversationsKey(orgSlug),
				(current) =>
					withConversationUnread(current, conversationId, data.unread),
			);

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
 * Load the timeline page around one search hit.
 *
 * The timeline cache is replaced by that single page, and its own cursor
 * becomes the "load older" continuation. The caller highlights the hit and
 * offers a jump back to the newest page.
 */
export function useJumpToMessage(orgSlug: string, conversationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (messageId: string) =>
			fetchMessagesAround(orgSlug, conversationId, messageId),
		onSuccess: (page: MessagePage) => {
			queryClient.setQueryData<MessagePages>(
				conversationMessagesKey(orgSlug, conversationId),
				{ pages: [page], pageParams: [null] },
			);
		},
	});
}

/**
 * Load the thread page around one search hit.
 *
 * The thread cache is replaced by that single page, and its own cursor becomes
 * the "load older" continuation. The caller highlights the hit and offers a
 * jump back to the newest page.
 */
export function useJumpToThreadMessage(
	orgSlug: string,
	conversationId: string,
	rootId: string,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (messageId: string) =>
			fetchThread(orgSlug, conversationId, rootId, {
				around: messageId,
			}),
		onSuccess: (page: ThreadPage) => {
			queryClient.setQueryData<ThreadPages>(
				conversationThreadKey(orgSlug, conversationId, rootId),
				{ pages: [page], pageParams: [null] },
			);
		},
	});
}

/** Re-export the page types the components narrow against. */
export type { ConversationsPage, MessagePage, ThreadPage };
