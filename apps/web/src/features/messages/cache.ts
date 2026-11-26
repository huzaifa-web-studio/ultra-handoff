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
	ChannelListResponse,
	ChannelSummary,
	ConversationMessage,
	ConversationSummary,
	ConversationsPage,
	Message,
	MessagePage,
	ThreadPage,
	ThreadReply,
	ThreadRoot,
} from "./api";

export type MessagePages = InfiniteData<MessagePage, string | null>;
export type ThreadPages = InfiniteData<ThreadPage, string | null>;
export type ConversationPages = InfiniteData<ConversationsPage, string | null>;

/** The activity fields a message event carries. */
export type ConversationActivity = {
	id: string;
	scope: "direct" | "group" | "project";
	lastMessageAt: string;
	lastMessageId: string;
	lastMessageAuthorId: string | null;
	lastMessagePreview: string;
};

/** A thread or conversation cursor. */
export type ThreadCursor = {
	lastReadAt: string | null;
	lastReadMessageId: string | null;
};

/** Sort key matching the server: timestamp, then id. */
function isBefore(
	first: { id: string; createdAt: string },
	second: { id: string; createdAt: string },
): boolean {
	if (first.createdAt !== second.createdAt) {
		return first.createdAt < second.createdAt;
	}

	return first.id < second.id;
}

/** Insert one ordered row, skipping an id that is already present. */
export function insertOrdered<T extends { id: string; createdAt: string }>(
	items: T[],
	item: T,
): T[] {
	if (items.some((existing) => existing.id === item.id)) return items;

	const next = [...items];
	const index = next.findIndex((existing) => isBefore(item, existing));

	if (index < 0) {
		next.push(item);
	} else {
		next.splice(index, 0, item);
	}

	return next;
}

/** Insert one root message in order. */
export function insertMessage(
	messages: Message[],
	message: Message,
): Message[] {
	return insertOrdered(messages, message);
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

/** Replace a root in place while keeping its reply summary. */
export function replaceRootMessage(
	pages: MessagePages | undefined,
	message: ConversationMessage,
): MessagePages | undefined {
	if (!pages) return pages;

	let changed = false;

	const next = pages.pages.map((page) => {
		const messages = page.messages.map((item) => {
			if (item.id !== message.id) return item;

			changed = true;

			return {
				...message,
				replyCount: item.replyCount,
				unreadReplyCount: item.unreadReplyCount,
			};
		});

		return messages === page.messages ? page : { ...page, messages };
	});

	return changed ? { ...pages, pages: next } : pages;
}

/** Append one reply to the newest thread page. */ export function appendThreadReply(
	pages: ThreadPages | undefined,
	reply: ThreadReply,
): ThreadPages | undefined {
	if (!pages || pages.pages.length === 0) return pages;

	const [newest, ...rest] = pages.pages;
	const replies = insertOrdered(newest.replies, reply);

	if (replies === newest.replies) return pages;

	return {
		...pages,
		pages: [{ ...newest, replies }, ...rest],
	};
}

/** Replace one thread reply in place. */
export function replaceThreadReply(
	pages: ThreadPages | undefined,
	reply: ThreadReply,
): ThreadPages | undefined {
	if (!pages) return pages;

	let changed = false;

	const next = pages.pages.map((page) => {
		const replies = page.replies.map((item) => {
			if (item.id !== reply.id) return item;

			changed = true;

			return reply;
		});

		return replies === page.replies ? page : { ...page, replies };
	});

	return changed ? { ...pages, pages: next } : pages;
}

/**
 * Replace the root of an open thread.
 *
 * Why: editing or deleting the root happens on the timeline cache, but a thread
 * panel or the dedicated thread route holds the same row in its own page. Without
 * this, a deleted root kept its body and its composer inside an open thread.
 */
export function replaceThreadRoot(
	pages: ThreadPages | undefined,
	message: ConversationMessage,
): ThreadPages | undefined {
	if (!pages) return pages;

	let changed = false;

	const next = pages.pages.map((page) => {
		if (page.root.id !== message.id) return page;

		changed = true;

		return { ...page, root: message };
	});

	return changed ? { ...pages, pages: next } : pages;
}

/** Update the viewer's thread cursor. */
export function withThreadRead(
	pages: ThreadPages | undefined,
	cursor: ThreadCursor,
): ThreadPages | undefined {
	if (!pages) return pages;

	return {
		...pages,
		pages: pages.pages.map((page) => ({ ...page, threadRead: cursor })),
	};
}

/** Update the other participant's thread cursor for the receipt. */
export function withThreadCounterpartRead(
	pages: ThreadPages | undefined,
	cursor: ThreadCursor,
): ThreadPages | undefined {
	if (!pages) return pages;

	return {
		...pages,
		pages: pages.pages.map((page) => ({ ...page, counterpartRead: cursor })),
	};
}

/** The newest item in a thread, a reply or the root. */
export function newestThreadItem(
	pages: ThreadPages | undefined,
): ThreadReply | ThreadRoot | null {
	const newest = pages?.pages[0];

	if (!newest) return null;

	return newest.replies[newest.replies.length - 1] ?? newest.root;
}

/**
 * Update one root's reply count and unread reply count.
 *
 * Used by a realtime reply, a reply mutation and the read receipt. `clearUnread`
 * wins over a delta so a thread read cannot leave a stale one behind.
 */
export function withRootReplyCount(
	pages: MessagePages | undefined,
	rootId: string,
	options: { replyDelta?: number; unreadDelta?: number; clearUnread?: boolean },
): MessagePages | undefined {
	if (!pages) return pages;

	let changed = false;

	const next = pages.pages.map((page) => {
		const messages = page.messages.map((message) => {
			if (message.id !== rootId) return message;

			changed = true;

			return {
				...message,
				replyCount: Math.max(0, message.replyCount + (options.replyDelta ?? 0)),
				unreadReplyCount: options.clearUnread
					? 0
					: Math.max(0, message.unreadReplyCount + (options.unreadDelta ?? 0)),
			};
		});

		return messages === page.messages ? page : { ...page, messages };
	});

	return changed ? { ...pages, pages: next } : pages;
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

/**
 * Apply one activity event to the flat channel list.
 *
 * Why not reuse `withConversationActivity`: the channel list is a single capped
 * array, not an infinite query, so there is no page to move a row between. The
 * row moves to the front of the same array and the section badge follows the
 * unread delta. `found` tells the realtime handler whether to refetch.
 */
export function applyChannelActivity(
	list: ChannelListResponse | undefined,
	activity: ConversationActivity,
	options: { viewerId: string; senderId: string | null; active: boolean },
): { list: ChannelListResponse | undefined; found: boolean } {
	if (!list) return { list, found: false };

	const current = list.channels.find((channel) => channel.id === activity.id);

	if (!current) return { list, found: false };

	const recipient =
		options.senderId !== null && options.senderId !== options.viewerId;
	const unread = options.active
		? 0
		: recipient
			? Math.min(99, current.unread + 1)
			: current.unread;
	const delta = unread - current.unread;

	const updated: ChannelSummary = {
		...current,
		unread,
		lastMessage: {
			id: activity.lastMessageId,
			authorId: activity.lastMessageAuthorId,
			authorName:
				activity.lastMessageAuthorId === options.viewerId
					? null
					: (current.lastMessage.authorName ?? null),
			preview: activity.lastMessagePreview,
			createdAt: activity.lastMessageAt,
		},
	};

	return {
		list: {
			channels: [
				updated,
				...list.channels.filter((channel) => channel.id !== activity.id),
			],
			unreadTotal: Math.max(0, list.unreadTotal + delta),
			truncated: list.truncated,
		},
		found: true,
	};
}

/** Set one channel's unread count and adjust the section badge. */
export function withChannelUnread(
	list: ChannelListResponse | undefined,
	conversationId: string,
	unread: number,
): ChannelListResponse | undefined {
	if (!list) return list;

	const current = list.channels.find(
		(channel) => channel.id === conversationId,
	);

	if (!current) return list;

	const delta = unread - current.unread;

	if (delta === 0) return list;

	return {
		channels: list.channels.map((channel) =>
			channel.id === conversationId ? { ...channel, unread } : channel,
		),
		unreadTotal: Math.max(0, list.unreadTotal + delta),
		truncated: list.truncated,
	};
}
