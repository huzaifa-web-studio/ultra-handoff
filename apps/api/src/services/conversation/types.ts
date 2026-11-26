/**
 * Conversation wire shapes.
 *
 * Why this file: the routes, the realtime payloads and every conversation
 * module name the same summary, participant and message shapes, so they live
 * together instead of drifting apart.
 *
 * Used by: every module in `services/conversation/` and `routes/conversations.ts`.
 */

import type { conversation } from "../../db/schema";

/** The scopes a conversation can carry. */
export type ConversationScope = "direct" | "group" | "project";

/** Channel access. Ignored for direct and project conversations. */
export type ChannelVisibility = "public" | "private";

/** One person in a conversation, with their read cursor. */
export type ConversationParticipantView = {
	userId: string;
	name: string;
	image: string | null;
	/** False once the person has left the workspace. History stays readable. */
	isMember: boolean;
	role: "owner" | "member";
	lastReadAt: string | null;
	lastReadMessageId: string | null;
};

/** The denormalised newest message a conversation row carries. */
export type ConversationLastMessage = {
	id: string | null;
	authorId: string | null;
	authorName: string | null;
	preview: string;
	createdAt: string | null;
};

/** One conversation as the list and the header render it. */
export type ConversationSummary = {
	id: string;
	scope: ConversationScope;
	title: string | null;
	/** Channel access. Ignored for direct conversations. */
	visibility: ChannelVisibility;
	/** Channel topic, shown in the header and the directory. */
	description: string | null;
	/** Set once a channel is archived. The UI turns the composer off. */
	archivedAt: string | null;
	/** Active participants, denormalised. Used by the channel directory. */
	memberCount: number;
	/** The other person in a direct conversation. Null for a group. */
	counterpart: ConversationParticipantView | null;
	participants: ConversationParticipantView[];
	lastMessage: ConversationLastMessage;
	/** Unread messages for this viewer, capped at 99. */
	unread: number;
	muted: boolean;
	/** True when the viewer owns a group conversation. */
	canManage: boolean;
	createdAt: string;
	updatedAt: string;
};

/** Normalised list input, already clamped by the route. */
export type ConversationListQuery = {
	cursor: string | null;
	limit: number;
};

export type ConversationListResult = {
	conversations: ConversationSummary[];
	/** Unread messages across every conversation, for the sidebar badge. */
	unreadTotal: number;
	nextCursor: string | null;
};

/** The author of a message. Null when the account was deleted. */
export type ConversationMessageAuthor = {
	id: string;
	name: string;
	image: string | null;
	isMember: boolean;
} | null;

/** One message on the wire. */
export type ConversationMessageRow = {
	id: string;
	conversationId: string;
	/** The root this row replies to. Null for a root. */
	parentId: string | null;
	/** Empty for a deleted message: the content is gone, the row is not. */
	body: unknown[];
	author: ConversationMessageAuthor;
	createdAt: string;
	updatedAt: string;
	editedAt: string | null;
	deletedAt: string | null;
	/** True when this caller wrote it and it is still editable. */
	canEdit: boolean;
	canDelete: boolean;
};

/** A root message plus the reply summary the main timeline renders. */
export type ConversationRootMessage = ConversationMessageRow & {
	/** Every reply in the thread, including deleted rows. */
	replyCount: number;
	/** Replies this viewer has not read, for the thread indicator. */
	unreadReplyCount: number;
};

/** Normalised page input. `around` is used by a search result jump. */
export type MessagePageQuery = {
	before: string | null;
	after: string | null;
	around: string | null;
	limit: number;
};

/** One page of the main timeline, oldest first inside the page. */
export type MessagePage = {
	messages: ConversationRootMessage[];
	/** Cursor for the next older page, or null at the start of the thread. */
	nextCursor: string | null;
	/** True when the `after` direction returned only part of the gap. */
	hasNewer: boolean;
	/** The other participant's conversation cursor, for the "Seen" marker. */
	counterpartRead: {
		lastReadAt: string | null;
		lastReadMessageId: string | null;
	} | null;
};

/** One person's cursor for one thread. */
export type ConversationThreadReadState = {
	lastReadAt: string | null;
	lastReadMessageId: string | null;
};

/** One page of one thread. The root is always included. */
export type ConversationThreadPage = {
	root: ConversationMessageRow;
	replies: ConversationMessageRow[];
	/** Every reply in the thread, including deleted rows and older pages. */
	replyCount: number;
	/** Cursor for older replies, or null at the start of the thread. */
	nextCursor: string | null;
	/** The viewer's thread cursor. */
	threadRead: ConversationThreadReadState;
	/** The other participant's thread cursor, for "Seen". */
	counterpartRead: ConversationThreadReadState | null;
};

/** The write result a send returns. */
export type ConversationMessageResult = {
	message: ConversationMessageRow;
	/** False when the client nonce already produced this message. */
	created: boolean;
	/** The fields the list needs to move this conversation to the top. */
	conversation: {
		id: string;
		scope: ConversationScope;
		lastMessageAt: string;
		lastMessageId: string;
		lastMessageAuthorId: string | null;
		lastMessagePreview: string;
	};
};

/** The read cursor move result. */
export type ConversationReadResult = {
	conversationId: string;
	scope: ConversationScope;
	/** Null when the conversation cursor moved, the root id for a thread. */
	threadRootId: string | null;
	lastReadAt: string;
	lastReadMessageId: string;
	unread: number;
	/** Every participant, so the route can publish to each side. */
	participantIds: string[];
};

/** One person the viewer may start a conversation with. */
export type ConversationContact = {
	userId: string;
	name: string;
	image: string | null;
	/** Organization role, shown as a hint in the picker. */
	role: string;
	/** Set when a conversation already exists, so the picker opens it. */
	conversationId: string | null;
};

/** One search hit inside a conversation. */
export type ConversationSearchRow = {
	id: string;
	/** The thread root the hit belongs to, for the client to open. */
	rootId: string;
	authorId: string | null;
	authorName: string;
	authorImage: string | null;
	createdAt: string;
	snippet: string;
};

export type ConversationSearchResult = {
	results: ConversationSearchRow[];
	hasMore: boolean;
};

/** Public send input. */
export type CreateConversationMessageInput = {
	body: unknown;
	/** Generated by the browser so a retry cannot post twice. */
	clientNonce: string;
	/** Set to reply inside a thread. The parent must be a root. */
	parentId?: string | null;
};

export type ConversationRecord = typeof conversation.$inferSelect;

/** Create input for a group channel. */
export type CreateChannelInput = {
	title: string;
	description?: string | null;
	visibility: ChannelVisibility;
	/** Everyone besides the creator. The creator becomes an owner. */
	memberIds?: string[];
};

/** Settings an owner may change. Omitted fields stay as they are. */
export type UpdateChannelInput = {
	title?: string;
	description?: string | null;
	visibility?: ChannelVisibility;
};

/** One channel in the joined sidebar list. */
export type ChannelListResult = {
	channels: ConversationSummary[];
	/** Unread across every joined channel, for the section badge. */
	unreadTotal: number;
};

/** One public channel in the browse directory. */
export type ChannelBrowseRow = {
	id: string;
	title: string;
	description: string | null;
	memberCount: number;
	/** True when the viewer already holds an active participant row. */
	joined: boolean;
	lastMessageAt: string | null;
	lastMessagePreview: string;
	createdAt: string;
};

export type ChannelBrowseQuery = {
	search: string;
	cursor: string | null;
	limit: number;
};

export type ChannelBrowseResult = {
	channels: ChannelBrowseRow[];
	nextCursor: string | null;
};

/** Limits shared by the service and the routes. */
export const CONVERSATION_PAGE_DEFAULT = 20;
export const CONVERSATION_PAGE_MAX = 50;
export const MESSAGE_PAGE_DEFAULT = 40;
export const MESSAGE_PAGE_MAX = 60;
export const MESSAGE_SEARCH_MAX = 25;

/** Channel naming and membership limits. */
export const CHANNEL_TITLE_MIN = 1;
export const CHANNEL_TITLE_MAX = 80;
export const CHANNEL_DESCRIPTION_MAX = 280;
/** Notification fan out is per member, so the cap is deliberate. */
export const CHANNEL_MEMBER_MAX = 100;
export const CHANNEL_LIST_MAX = 200;
export const CHANNEL_BROWSE_DEFAULT = 20;
export const CHANNEL_BROWSE_MAX = 50;
