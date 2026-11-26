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

/** One page of the main timeline. */
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
/** A root message, with its reply summary. */
export type Message = MessagePage["messages"][number];

/** One thread page, root plus replies. */
export async function fetchThread(
	orgSlug: string,
	conversationId: string,
	rootId: string,
	options?: { before?: string; around?: string },
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.threads({ rootId })
		.get({ query: options ?? {} });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the thread."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the thread.", 0);
	}

	return response.data;
}

export type ThreadPage = Awaited<ReturnType<typeof fetchThread>>;
export type ConversationMessage = ThreadPage["root"];
export type ThreadRoot = ThreadPage["root"];
export type ThreadReply = ThreadPage["replies"][number];

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
	input: { body: unknown[]; clientNonce: string; parentId?: string | null },
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

/** Move one thread's read cursor. */
export async function markThreadRead(
	orgSlug: string,
	conversationId: string,
	rootId: string,
	messageId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.threads({ rootId })
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

/** Channels the viewer has joined, including empty ones. */
export async function fetchChannels(orgSlug: string) {
	const response = await api.orgs({ orgSlug }).channels.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load your channels."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load your channels.", 0);
	}

	return response.data;
}

export type ChannelListResponse = Awaited<ReturnType<typeof fetchChannels>>;
export type ChannelSummary = ChannelListResponse["channels"][number];

/** Public channels in the workspace, one page at a time. */
export async function fetchChannelBrowse(
	orgSlug: string,
	search: string,
	cursor: string | null,
) {
	const query = {
		...(search ? { search } : {}),
		...(cursor ? { cursor } : {}),
	};
	const response = await api.orgs({ orgSlug }).channels.browse.get({ query });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the channels."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the channels.", 0);
	}

	return response.data;
}

export type ChannelBrowseResponse = Awaited<
	ReturnType<typeof fetchChannelBrowse>
>;
export type ChannelBrowseItem = ChannelBrowseResponse["channels"][number];

/** Channels the viewer still belongs to that an owner archived. */
export async function fetchArchivedChannels(orgSlug: string) {
	const response = await api.orgs({ orgSlug }).channels.archived.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the archived channels."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the archived channels.", 0);
	}

	return response.data;
}

export type ArchivedChannelsResponse = Awaited<
	ReturnType<typeof fetchArchivedChannels>
>;

/** Create a channel. */
export async function createChannel(
	orgSlug: string,
	input: {
		title: string;
		description?: string | null;
		visibility: "public" | "private";
		memberIds?: string[];
	},
) {
	const response = await api.orgs({ orgSlug }).channels.post(input);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not create the channel."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not create the channel.", 0);
	}

	return response.data;
}

export type CreateChannelResponse = Awaited<ReturnType<typeof createChannel>>;

/** Change a channel's settings. */
export async function updateChannel(
	orgSlug: string,
	conversationId: string,
	input: {
		title?: string;
		description?: string | null;
		visibility?: "public" | "private";
	},
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.patch(input);

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not save the channel."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not save the channel.", 0);
	}

	return response.data;
}

export type UpdateChannelResponse = Awaited<ReturnType<typeof updateChannel>>;

/** Join a public channel. */
export async function joinChannel(orgSlug: string, conversationId: string) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.join.post();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not join the channel."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not join the channel.", 0);
	}

	return response.data;
}

/** Leave a channel. */
export async function leaveChannel(orgSlug: string, conversationId: string) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.leave.post();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not leave the channel."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not leave the channel.", 0);
	}

	return response.data;
}

/** Add people to a channel. */
export async function addChannelMembers(
	orgSlug: string,
	conversationId: string,
	userIds: string[],
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.members.post({ userIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not add those people."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not add those people.", 0);
	}

	return response.data;
}

/** Remove one member. */
export async function removeChannelMember(
	orgSlug: string,
	conversationId: string,
	userId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.members({ userId })
		.delete();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not remove that person."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not remove that person.", 0);
	}

	return response.data;
}

/** Promote or demote one member. */
export async function setChannelMemberRole(
	orgSlug: string,
	conversationId: string,
	userId: string,
	role: "owner" | "member",
) {
	const response = await api
		.orgs({ orgSlug })
		.conversations({ conversationId })
		.members({ userId })
		.patch({ role });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not change that role."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not change that role.", 0);
	}

	return response.data;
}

/** Mute or unmute a channel for the viewer. */
export async function setChannelMuted(
	orgSlug: string,
	conversationId: string,
	muted: boolean,
) {
	const conversation = api.orgs({ orgSlug }).conversations({ conversationId });
	const response = muted
		? await conversation.mute.post()
		: await conversation.unmute.post();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(
				response.error,
				muted ? "Could not mute the channel." : "Could not unmute the channel.",
			),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not change the channel.", 0);
	}

	return response.data;
}

/** Archive or restore a channel. */
export async function setChannelArchived(
	orgSlug: string,
	conversationId: string,
	archived: boolean,
) {
	const conversation = api.orgs({ orgSlug }).conversations({ conversationId });
	const response = archived
		? await conversation.archive.post()
		: await conversation.restore.post();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(
				response.error,
				archived
					? "Could not archive the channel."
					: "Could not restore the channel.",
			),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not change the channel.", 0);
	}

	return response.data;
}
