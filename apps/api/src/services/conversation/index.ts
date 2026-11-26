/**
 * Public surface of the conversation module.
 *
 * Why: routes and the realtime handler import one entry point instead of
 * reaching into individual files.
 *
 * Used by: `routes/conversations.ts`, `routes/channels/`,
 * `realtime/gateway/message.ts` and the realtime payload types.
 */

export {
	type ConversationAccess,
	decodeCursor,
	encodeCursor,
	loadTypingTargets,
	type MessageRecord,
	type ParticipantRecord,
	pairKey,
} from "./access";
export {
	addChannelMembers,
	browseChannels,
	type ChannelResult,
	createChannel,
	decodeBrowseCursor,
	encodeBrowseCursor,
	joinChannel,
	type LeaveChannelResult,
	leaveChannel,
	listArchivedChannels,
	listChannels,
	removeChannelMember,
	setChannelArchived,
	setChannelMemberRole,
	setChannelMuted,
	updateChannel,
} from "./channels";
export { createConversationMessage } from "./create";
export {
	countUnreadByConversation,
	listConversations,
	sumUnread,
} from "./list";
export {
	listConversationRoots,
	listThreadReplies,
} from "./messages";
export {
	getConversation,
	listContacts,
	openDirectConversation,
} from "./open";
export { markConversationRead, markThreadRead } from "./read";
export { searchConversationMessages } from "./search";
export type {
	ChannelBrowseQuery,
	ChannelBrowseResult,
	ChannelBrowseRow,
	ChannelListResult,
	ChannelVisibility,
	ConversationContact,
	ConversationLastMessage,
	ConversationListQuery,
	ConversationListResult,
	ConversationMessageResult,
	ConversationMessageRow,
	ConversationParticipantView,
	ConversationReadResult,
	ConversationRootMessage,
	ConversationScope,
	ConversationSearchResult,
	ConversationSearchRow,
	ConversationSummary,
	ConversationThreadPage,
	ConversationThreadReadState,
	CreateChannelInput,
	CreateConversationMessageInput,
	MessagePage,
	MessagePageQuery,
	UpdateChannelInput,
} from "./types";
export {
	CHANNEL_BROWSE_DEFAULT,
	CHANNEL_BROWSE_MAX,
	CHANNEL_DESCRIPTION_MAX,
	CHANNEL_LIST_MAX,
	CHANNEL_MEMBER_MAX,
	CHANNEL_TITLE_MAX,
	CHANNEL_TITLE_MIN,
} from "./types";
export type { ConversationMessageMutationResult } from "./update";
export { deleteConversationMessage, editConversationMessage } from "./update";
