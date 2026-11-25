/**
 * Pure cache reducers for messaging.
 *
 * Why pure functions: the mutation handlers and the realtime handler both patch
 * the same caches. Sharing the reducers means a save and a stream event cannot
 * drift apart, and the rules are testable without React.
 *
 * Page shape: an infinite query paged by the `before` cursor, so `pages[0]` is
 * the newest page. A new message always lands in `pages[0]`.
 *
 * Used by: features/messages/hooks.ts and features/messages/realtime.ts.
 */

import type { InfiniteData } from "@tanstack/react-query";
import type {
	ConversationSummary,
	ConversationsPage,
	Message,
	MessagePage,
} from "./api";

export type MessagePages = InfiniteData<MessagePage, string | null>;
export type ConversationPages = InfiniteData<ConversationsPage, string | null>;

/** The activity fields a message event carries. */
export type ConversationActivity = {
	id: string;
	lastMessageAt: string;
	lastMessageId: string;
	lastMessageAuthorId: string | null;
	lastMessagePreview: string;
};

/** Sort key matching the server: timestamp, then id. */
function isBefore(first: Message, second: Message): boolean {
	if (first.createdAt !== second.createdAt) {
		return first.createdAt < second.createdAt;
	}

	return first.id < second.id;
}

/** Insert one message in order, skipping an id that is already present. */
export function insertMessage(
	messages: Message[],
	message: Message,
): Message[] {
	if (messages.some((item) => item.id === message.id)) return messages;

	const next = [...messages];
	const index = next.findIndex((item) => isBefore(message, item));

	if (index < 0) {
		next.push(message);
	} else {
		next.splice(index, 0, message);
	}

	return next;
}

/** Append one message to the newest page. */
export function appendMessage(
	pages: MessagePages | undefined,
	message: Message,
): MessagePages | undefined {
	if (!pages || pages.pages.length === 0) return pages;

	const [newest, ...rest] = pages.pages;
	const messages = insertMessage(newest.messages, message);

	if (messages === newest.messages) return pages;

	return {
		...pages,
		pages: [{ ...newest, messages }, ...rest],
	};
}

/** Replace one message in place, keeping its position. */
export function replaceMessage(
	pages: MessagePages | undefined,
	message: Message,
): MessagePages | undefined {
	if (!pages) return pages;

	let changed = false;

	const next = pages.pages.map((page) => {
		const messages = page.messages.map((item) => {
			if (item.id !== message.id) return item;

			changed = true;

			return message;
		});

		return messages === page.messages ? page : { ...page, messages };
	});

	return changed ? { ...pages, pages: next } : pages;
}

/** Move the other participant's read cursor in every loaded page. */
export function withCounterpartRead(
	pages: MessagePages | undefined,
	cursor: { lastReadAt: string; lastReadMessageId: string },
): MessagePages | undefined {
	if (!pages) return pages;

	return {
		...pages,
		pages: pages.pages.map((page) => ({
			...page,
			counterpartRead: cursor,
		})),
	};
}

/** Read the newest loaded message in a thread. */
export function newestMessage(pages: MessagePages | undefined): Message | null {
	const newest = pages?.pages[0];

	if (!newest || newest.messages.length === 0) return null;

	return newest.messages[newest.messages.length - 1] ?? null;
}

/** Read every loaded conversation without duplicates across pages. */
export function flattenConversations(
	pages: InfiniteData<ConversationsPage, unknown> | undefined,
): ConversationSummary[] {
	if (!pages) return [];

	const seen = new Set<string>();
	const result: ConversationSummary[] = [];

	for (const page of pages.pages) {
		for (const conversation of page.conversations) {
			if (seen.has(conversation.id)) continue;

			seen.add(conversation.id);
			result.push(conversation);
		}
	}

	return result;
}

/**
 * Apply one activity event to the conversation list.
 *
 * The row moves to the front of the newest page, its preview updates, and the
 * unread count moves only for the recipient while the chat is not on screen.
 * `found` tells the caller whether the list already knew the conversation, so a
 * message from a brand new chat can trigger one refetch instead of silently
 * missing a row.
 */
export function withConversationActivity(
	pages: ConversationPages | undefined,
	activity: ConversationActivity,
	options: { viewerId: string; senderId: string | null; active: boolean },
): { pages: ConversationPages | undefined; found: boolean } {
	if (!pages) return { pages, found: false };

	let found = false;
	let moved: ConversationSummary | null = null;

	const stripped = pages.pages.map((page) => {
		const conversations = page.conversations.filter((conversation) => {
			if (conversation.id !== activity.id) return true;

			found = true;
			moved = conversation;

			return false;
		});

		return {
			...page,
			conversations,
			unreadTotal: page.unreadTotal,
		};
	});

	if (!found || !moved) return { pages, found: false };

	const current = moved as ConversationSummary;
	const recipient =
		options.senderId !== null && options.senderId !== options.viewerId;
	const unread = options.active
		? 0
		: recipient
			? Math.min(99, current.unread + 1)
			: current.unread;
	const delta = unread - current.unread;

	const updated: ConversationSummary = {
		...current,
		unread,
		lastMessage: {
			id: activity.lastMessageId,
			authorId: activity.lastMessageAuthorId,
			authorName:
				activity.lastMessageAuthorId === options.viewerId
					? null
					: (current.lastMessage.authorName ??
						current.counterpart?.name ??
						null),
			preview: activity.lastMessagePreview,
			createdAt: activity.lastMessageAt,
		},
	};

	const [first, ...rest] = stripped;
	const firstPage = first ?? {
		conversations: [],
		unreadTotal: 0,
		nextCursor: null,
	};

	return {
		pages: {
			...pages,
			pages: [
				{
					...firstPage,
					conversations: [updated, ...firstPage.conversations],
					unreadTotal: Math.max(0, firstPage.unreadTotal + delta),
				},
				...rest,
			],
		},
		found: true,
	};
}

/** Set one conversation's unread count, adjusting the workspace total. */
export function withConversationUnread(
	pages: ConversationPages | undefined,
	conversationId: string,
	unread: number,
): ConversationPages | undefined {
	if (!pages) return pages;

	let delta = 0;

	const next = pages.pages.map((page) => ({
		...page,
		conversations: page.conversations.map((conversation) => {
			if (conversation.id !== conversationId) return conversation;

			delta += unread - conversation.unread;

			return { ...conversation, unread };
		}),
	}));

	if (delta === 0) return pages;

	return {
		...pages,
		pages: next.map((page) => ({
			...page,
			unreadTotal: Math.max(0, page.unreadTotal + delta),
		})),
	};
}

/** Insert or replace one conversation at the front of the list. */
export function upsertConversation(
	pages: ConversationPages | undefined,
	conversation: ConversationSummary,
): ConversationPages | undefined {
	if (!pages) return pages;

	const seen = new Set<string>();
	const stripped = pages.pages.map((page) => ({
		...page,
		conversations: page.conversations.filter((item) => {
			if (item.id === conversation.id) return false;
			if (seen.has(item.id)) return false;

			seen.add(item.id);

			return true;
		}),
	}));
	const [first, ...rest] = stripped;
	const firstPage = first ?? {
		conversations: [],
		unreadTotal: 0,
		nextCursor: null,
	};

	// An empty conversation has no activity yet, so it does not join the list
	// until the first message. Returning the list unchanged keeps that rule.
	if (!conversation.lastMessage.createdAt) return pages;

	return {
		...pages,
		pages: [
			{
				...firstPage,
				conversations: [conversation, ...firstPage.conversations],
			},
			...rest,
		],
	};
}
