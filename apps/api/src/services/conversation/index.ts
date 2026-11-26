/**
 * Public surface of the conversation module.
 *
 * Why: routes and the realtime handler import one entry point instead of
 * reaching into individual files.
 *
 * Used by: `routes/conversations.ts`, `realtime/gateway/message.ts` and the
 * realtime payload types.
 */

export {
	type ConversationAccess,
	decodeCursor,
	encodeCursor,
	loadTypingTarget,
	type MessageRecord,
	type ParticipantRecord,
	pairKey,
} from "./access";
export { createConversationMessage } from "./create";
export { listConversations } from "./list";
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
	CreateConversationMessageInput,
	MessagePage,
	MessagePageQuery,
} from "./types";
export type { ConversationMessageMutationResult } from "./update";
export { deleteConversationMessage, editConversationMessage } from "./update";
