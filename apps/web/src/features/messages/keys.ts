/**
 * Query keys for messaging.
 *
 * Why their own module: the notification provider invalidates the conversation
 * list from outside the feature, and one prefix has to cover every messaging
 * surface. Keeping the builders here means a rename cannot leave a stale key
 * behind.
 *
 * Used by: features/messages/hooks.ts, features/messages/realtime.ts and the
 * notification realtime provider.
 */

/** Every messaging query for one workspace. */
export function messagesKey(orgSlug: string) {
	return ["organization", orgSlug, "messages"] as const;
}

/** The sidebar and page conversation list. */
export function conversationsKey(orgSlug: string) {
	return [...messagesKey(orgSlug), "conversations"] as const;
}

/** One conversation header. */
export function conversationKey(orgSlug: string, conversationId: string) {
	return [...messagesKey(orgSlug), "conversation", conversationId] as const;
}

/** One message thread, paged by the before cursor. */
export function conversationMessagesKey(
	orgSlug: string,
	conversationId: string,
) {
	return [...messagesKey(orgSlug), "thread", conversationId] as const;
}

/** One thread, paged by the before cursor. */
export function conversationThreadKey(
	orgSlug: string,
	conversationId: string,
	rootId: string,
) {
	return [...messagesKey(orgSlug), "thread", conversationId, rootId] as const;
}

/** One in conversation search. */
export function conversationSearchKey(
	orgSlug: string,
	conversationId: string,
	search: string,
) {
	return [...messagesKey(orgSlug), "search", conversationId, search] as const;
}

/** The new conversation picker. */
export function contactsKey(orgSlug: string, search: string) {
	return [...messagesKey(orgSlug), "contacts", search] as const;
}
