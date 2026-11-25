/**
 * Typed Eden calls for conversations.
 *
 * Why a feature API module: components never call `api` directly. The request
 * shape, the error conversion and the derived types live here, so a route
 * change only touches this file.
 *
 * Used by: features/messages/hooks.ts.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";

/** Read one page of conversations, newest activity first. */
export async function fetchConversations(
	orgSlug: string,
	cursor: string | null,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations.get({ query: cursor ? { cursor } : {} });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load your conversations."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load your conversations.", 0);
	}

	return response.data;
}

export type ConversationsPage = Awaited<ReturnType<typeof fetchConversations>>;
export type ConversationSummary = ConversationsPage["conversations"][number];
export type ConversationParticipant =
	ConversationSummary["participants"][number];

/** Resolve the direct conversation with one person, creating it if needed. */
export async function openConversation(orgSlug: string, userId: string) {
	const response = await api.orgs({ orgSlug }).conversations.post({ userId });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not open that conversation."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not open that conversation.", 0);
	}

	return response.data;
}

export type OpenConversationResponse = Awaited<
	ReturnType<typeof openConversation>
>;

/** One conversation header. */
export async function fetchConversation(
	orgSlug: string,
	conversationId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load that conversation."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load that conversation.", 0);
	}

	return response.data;
}

export type ConversationDetailResponse = Awaited<
	ReturnType<typeof fetchConversation>
>;

/** One page of messages. `before` pages backwards. */
export async function fetchMessages(
	orgSlug: string,
	conversationId: string,
	before: string | null,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.messages.get({ query: before ? { before } : {} });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the messages."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the messages.", 0);
	}

	return response.data;
}

export type MessagePage = Awaited<ReturnType<typeof fetchMessages>>;
export type Message = MessagePage["messages"][number];

/** One page around a specific message, used by a search jump. */
export async function fetchMessagesAround(
	orgSlug: string,
	conversationId: string,
	messageId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.messages.get({ query: { around: messageId } });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load that message."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load that message.", 0);
	}

	return response.data;
}

/** Send a message. The nonce makes a retry safe. */
export async function sendMessage(
	orgSlug: string,
	conversationId: string,
	input: { body: unknown[]; clientNonce: string },
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.messages.post(input);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not send the message."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not send the message.", 0);
	}

	return response.data;
}

export type SendMessageResponse = Awaited<ReturnType<typeof sendMessage>>;

/** Change the body of your own message. */
export async function editMessage(
	orgSlug: string,
	conversationId: string,
	messageId: string,
	body: unknown[],
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.messages({ messageId })
		.patch({ body });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not save the message."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not save the message.", 0);
	}

	return response.data;
}

/** Soft delete your own message. */
export async function deleteMessage(
	orgSlug: string,
	conversationId: string,
	messageId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.messages({ messageId })
		.delete();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not delete the message."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not delete the message.", 0);
	}

	return response.data;
}

/** Move the read cursor to one message. */
export async function markRead(
	orgSlug: string,
	conversationId: string,
	messageId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.read.post({ messageId });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not update the read state."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not update the read state.", 0);
	}

	return response.data;
}

/** Search inside one conversation. */
export async function searchMessages(
	orgSlug: string,
	conversationId: string,
	search: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.search.get({ query: { q: search } });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not search this conversation."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not search this conversation.", 0);
	}

	return response.data;
}

export type MessageSearchResponse = Awaited<ReturnType<typeof searchMessages>>;
export type MessageSearchRow = MessageSearchResponse["results"][number];

/** Everyone the viewer may start a conversation with. */
export async function fetchContacts(orgSlug: string, search: string) {
	const response = await api.orgs({ orgSlug }).conversations.contacts.get({
		query: search ? { search } : {},
	});

	if (response.error) {
		throw new ApiRequestError(
			readApiError(
				response.error,
				"Could not load the people you can message.",
			),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the people you can message.", 0);
	}

	return response.data;
}

export type ContactsResponse = Awaited<ReturnType<typeof fetchContacts>>;
export type Contact = ContactsResponse["contacts"][number];
