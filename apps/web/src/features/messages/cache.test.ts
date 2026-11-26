/**
 * Message cache reducer tests.
 *
 * Why these matter: a realtime event and a mutation response both add the same
 * message, and a reconnect can replay one. The reducers must be idempotent, or
 * the author sees their own message twice. The conversation list must also move
 * a row to the top without losing its unread count.
 */

import { describe, expect, it } from "bun:test";

import type {
	ConversationSummary,
	Message,
	ThreadReply,
	ThreadRoot,
} from "./api";
import {
	appendMessage,
	appendThreadReply,
	type ConversationPages,
	flattenConversations,
	type MessagePages,
	replaceMessage,
	replaceThreadReply,
	type ThreadPages,
	withConversationActivity,
	withConversationUnread,
	withCounterpartRead,
	withRootReplyCount,
	withThreadCounterpartRead,
} from "./cache";

/** One message with the fields a cache patch touches. */
function makeMessage(overrides: Partial<Message> = {}): Message {
	return {
		id: "message-1",
		conversationId: "conversation-1",
		parentId: null,
		body: [{ type: "p", children: [{ text: "hello" }] }],
		author: {
			id: "user-1",
			name: "Ayesha",
			image: null,
			isMember: true,
		},
		createdAt: "2026-01-01T10:00:00.000Z",
		updatedAt: "2026-01-01T10:00:00.000Z",
		editedAt: null,
		deletedAt: null,
		canEdit: true,
		canDelete: true,
		replyCount: 0,
		unreadReplyCount: 0,
		...overrides,
	};
}

/** One conversation with the fields a cache patch touches. */
function makeConversation(
	overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
	return {
		id: "conversation-1",
		scope: "direct",
		title: null,
		counterpart: {
			userId: "user-2",
			name: "Bilal",
			image: null,
			isMember: true,
			role: "member",
			lastReadAt: "2026-01-01T09:00:00.000Z",
			lastReadMessageId: null,
		},
		participants: [],
		lastMessage: {
			id: "message-1",
			authorId: "user-1",
			authorName: "Ayesha",
			preview: "hello",
			createdAt: "2026-01-01T10:00:00.000Z",
		},
		unread: 0,
		muted: false,
		createdAt: "2026-01-01T09:00:00.000Z",
		updatedAt: "2026-01-01T10:00:00.000Z",
		...overrides,
	};
}

function messagePages(messages: Message[]): MessagePages {
	return {
		pages: [
			{
				messages,
				nextCursor: null,
				hasNewer: false,
				counterpartRead: null,
			},
		],
		pageParams: [null],
	};
}

/** One thread reply, without the root only reply summary. */
function makeThreadReply(overrides: Partial<ThreadReply> = {}): ThreadReply {
	return {
		id: "reply-1",
		conversationId: "conversation-1",
		parentId: "root-1",
		body: [{ type: "p", children: [{ text: "a reply" }] }],
		author: {
			id: "user-2",
			name: "Bilal",
			image: null,
			isMember: true,
		},
		createdAt: "2026-01-01T10:05:00.000Z",
		updatedAt: "2026-01-01T10:05:00.000Z",
		editedAt: null,
		deletedAt: null,
		canEdit: false,
		canDelete: false,
		...overrides,
	};
}

/** One thread root. */
function makeThreadRoot(overrides: Partial<ThreadRoot> = {}): ThreadRoot {
	return {
		...makeThreadReply({ parentId: null }),
		id: "root-1",
		author: {
			id: "user-1",
			name: "Ayesha",
			image: null,
			isMember: true,
		},
		createdAt: "2026-01-01T10:00:00.000Z",
		updatedAt: "2026-01-01T10:00:00.000Z",
		...overrides,
	};
}

function threadPages(
	replies: ThreadReply[],
	root: ThreadRoot = makeThreadRoot(),
): ThreadPages {
	return {
		pages: [
			{
				root,
				replies,
				nextCursor: null,
				threadRead: { lastReadAt: null, lastReadMessageId: null },
				counterpartRead: null,
			},
		],
		pageParams: [null],
	};
}

function conversationPages(
	conversations: ConversationSummary[],
): ConversationPages {
	return {
		pages: [
			{
				conversations,
				unreadTotal: conversations.reduce(
					(sum, conversation) => sum + conversation.unread,
					0,
				),
				nextCursor: null,
			},
		],
		pageParams: [null],
	};
}

describe("appendMessage", () => {
	it("appends a new message to the newest page", () => {
		const pages = messagePages([makeMessage()]);
		const next = appendMessage(
			pages,
			makeMessage({
				id: "message-2",
				createdAt: "2026-01-01T10:05:00.000Z",
			}),
		);

		expect(next?.pages[0]?.messages.map((message) => message.id)).toEqual([
			"message-1",
			"message-2",
		]);
	});

	it("is idempotent for a replayed event", () => {
		const pages = messagePages([makeMessage()]);
		const next = appendMessage(pages, makeMessage());

		expect(next).toBe(pages);
	});

	it("inserts an out of order message in the right place", () => {
		const pages = messagePages([
			makeMessage({ id: "message-2", createdAt: "2026-01-01T10:10:00.000Z" }),
		]);
		const next = appendMessage(
			pages,
			makeMessage({ id: "message-1", createdAt: "2026-01-01T10:00:00.000Z" }),
		);

		expect(next?.pages[0]?.messages.map((message) => message.id)).toEqual([
			"message-1",
			"message-2",
		]);
	});
});

describe("replaceMessage", () => {
	it("replaces a row without changing its position", () => {
		const pages = messagePages([
			makeMessage({ id: "message-1" }),
			makeMessage({ id: "message-2" }),
		]);
		const next = replaceMessage(
			pages,
			makeMessage({
				id: "message-1",
				deletedAt: "2026-01-01T11:00:00.000Z",
				body: [],
			}),
		);

		expect(next?.pages[0]?.messages[0]?.deletedAt).toBe(
			"2026-01-01T11:00:00.000Z",
		);
		expect(next?.pages[0]?.messages[1]?.id).toBe("message-2");
	});

	it("returns the same pages when the id is absent", () => {
		const pages = messagePages([makeMessage()]);
		const next = replaceMessage(pages, makeMessage({ id: "missing" }));

		expect(next).toBe(pages);
	});
});

describe("withCounterpartRead", () => {
	it("updates every loaded page", () => {
		const pages: MessagePages = {
			pages: [
				{
					messages: [],
					nextCursor: null,
					hasNewer: false,
					counterpartRead: null,
				},
				{
					messages: [],
					nextCursor: null,
					hasNewer: false,
					counterpartRead: null,
				},
			],
			pageParams: [null, "cursor"],
		};
		const next = withCounterpartRead(pages, {
			lastReadAt: "2026-01-01T12:00:00.000Z",
			lastReadMessageId: "message-9",
		});

		expect(
			next?.pages.every(
				(page) => page.counterpartRead?.lastReadMessageId === "message-9",
			),
		).toBe(true);
	});
});

describe("withConversationActivity", () => {
	it("moves the conversation to the front and updates the preview", () => {
		const pages = conversationPages([
			makeConversation({ id: "conversation-1" }),
			makeConversation({
				id: "conversation-2",
				lastMessage: {
					id: "old",
					authorId: "user-2",
					authorName: "Bilal",
					preview: "older",
					createdAt: "2026-01-01T09:30:00.000Z",
				},
			}),
		]);

		const result = withConversationActivity(
			pages,
			{
				id: "conversation-2",
				lastMessageAt: "2026-01-01T12:00:00.000Z",
				lastMessageId: "new",
				lastMessageAuthorId: "user-2",
				lastMessagePreview: "newest",
			},
			{ viewerId: "user-1", senderId: "user-2", active: false },
		);

		expect(result.found).toBe(true);
		expect(result.pages?.pages[0]?.conversations[0]?.id).toBe("conversation-2");
		expect(result.pages?.pages[0]?.conversations[0]?.lastMessage.preview).toBe(
			"newest",
		);
		expect(result.pages?.pages[0]?.conversations[0]?.unread).toBe(1);
	});

	it("does not bump unread for the sender", () => {
		const pages = conversationPages([makeConversation({ unread: 2 })]);
		const result = withConversationActivity(
			pages,
			{
				id: "conversation-1",
				lastMessageAt: "2026-01-01T12:00:00.000Z",
				lastMessageId: "new",
				lastMessageAuthorId: "user-1",
				lastMessagePreview: "mine",
			},
			{ viewerId: "user-1", senderId: "user-1", active: false },
		);

		expect(result.pages?.pages[0]?.conversations[0]?.unread).toBe(2);
	});

	it("clears unread while the conversation is on screen", () => {
		const pages = conversationPages([makeConversation({ unread: 4 })]);
		const result = withConversationActivity(
			pages,
			{
				id: "conversation-1",
				lastMessageAt: "2026-01-01T12:00:00.000Z",
				lastMessageId: "new",
				lastMessageAuthorId: "user-2",
				lastMessagePreview: "hello",
			},
			{ viewerId: "user-1", senderId: "user-2", active: true },
		);

		expect(result.pages?.pages[0]?.conversations[0]?.unread).toBe(0);
	});

	it("reports a conversation the list did not know", () => {
		const pages = conversationPages([makeConversation()]);
		const result = withConversationActivity(
			pages,
			{
				id: "unknown",
				lastMessageAt: "2026-01-01T12:00:00.000Z",
				lastMessageId: "new",
				lastMessageAuthorId: "user-2",
				lastMessagePreview: "hello",
			},
			{ viewerId: "user-1", senderId: "user-2", active: false },
		);

		expect(result.found).toBe(false);
		expect(result.pages).toBe(pages);
	});
});

describe("withConversationUnread", () => {
	it("sets the count and adjusts the workspace total", () => {
		const pages = conversationPages([
			makeConversation({ unread: 3 }),
			makeConversation({ id: "conversation-2", unread: 1 }),
		]);
		const next = withConversationUnread(pages, "conversation-1", 0);

		expect(next?.pages[0]?.conversations[0]?.unread).toBe(0);
		expect(next?.pages[0]?.unreadTotal).toBe(1);
	});
});

describe("flattenConversations", () => {
	it("keeps one row per id across pages", () => {
		const pages: ConversationPages = {
			pages: [
				{
					conversations: [makeConversation({ id: "conversation-1" })],
					unreadTotal: 0,
					nextCursor: "next",
				},
				{
					conversations: [
						makeConversation({ id: "conversation-1" }),
						makeConversation({ id: "conversation-2" }),
					],
					unreadTotal: 0,
					nextCursor: null,
				},
			],
			pageParams: [null, "next"],
		};

		expect(flattenConversations(pages).map((row) => row.id)).toEqual([
			"conversation-1",
			"conversation-2",
		]);
	});
});

describe("appendThreadReply", () => {
	it("appends a reply to the newest reply page", () => {
		const pages = threadPages([makeThreadReply()]);
		const next = appendThreadReply(
			pages,
			makeThreadReply({
				id: "reply-2",
				createdAt: "2026-01-01T10:10:00.000Z",
			}),
		);

		expect(next?.pages[0]?.replies.map((reply) => reply.id)).toEqual([
			"reply-1",
			"reply-2",
		]);
	});

	it("is idempotent for a replayed reply", () => {
		const pages = threadPages([makeThreadReply()]);
		const next = appendThreadReply(pages, makeThreadReply());

		expect(next).toBe(pages);
	});
});

describe("replaceThreadReply", () => {
	it("replaces a reply in place", () => {
		const pages = threadPages([
			makeThreadReply({ id: "reply-1" }),
			makeThreadReply({
				id: "reply-2",
				createdAt: "2026-01-01T10:10:00.000Z",
			}),
		]);
		const next = replaceThreadReply(
			pages,
			makeThreadReply({
				id: "reply-1",
				deletedAt: "2026-01-01T11:00:00.000Z",
				body: [],
			}),
		);

		expect(next?.pages[0]?.replies[0]?.deletedAt).toBe(
			"2026-01-01T11:00:00.000Z",
		);
		expect(next?.pages[0]?.replies[1]?.id).toBe("reply-2");
	});
});

describe("withRootReplyCount", () => {
	it("increments the reply and unread reply counts", () => {
		const pages = messagePages([
			makeMessage({ replyCount: 1, unreadReplyCount: 0 }),
		]);
		const next = withRootReplyCount(pages, "message-1", {
			replyDelta: 1,
			unreadDelta: 1,
		});

		expect(next?.pages[0]?.messages[0]?.replyCount).toBe(2);
		expect(next?.pages[0]?.messages[0]?.unreadReplyCount).toBe(1);
	});

	it("clears the unread reply count", () => {
		const pages = messagePages([
			makeMessage({ replyCount: 3, unreadReplyCount: 2 }),
		]);
		const next = withRootReplyCount(pages, "message-1", {
			clearUnread: true,
		});

		expect(next?.pages[0]?.messages[0]?.unreadReplyCount).toBe(0);
	});

	it("returns the same pages for a root that is not loaded", () => {
		const pages = messagePages([makeMessage()]);
		const next = withRootReplyCount(pages, "missing", { replyDelta: 1 });

		expect(next).toBe(pages);
	});
});

describe("withThreadCounterpartRead", () => {
	it("updates the receipt on every page", () => {
		const pages = threadPages([]);
		const next = withThreadCounterpartRead(pages, {
			lastReadAt: "2026-01-01T12:00:00.000Z",
			lastReadMessageId: "reply-9",
		});

		expect(
			next?.pages.every(
				(page) => page.counterpartRead?.lastReadMessageId === "reply-9",
			),
		).toBe(true);
	});
});
