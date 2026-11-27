/**
 * Typed Eden calls for the project message room.
 *
 * Why a feature API module: the project tab never calls the client directly.
 * Request shapes and error conversion live here so a route change touches one
 * file.
 *
 * Used by: features/projects/messages/hooks.ts.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";

/**
 * Open the project room.
 *
 * The API call is idempotent, so this doubles as the first open and as a
 * refresh of the room header.
 */
export async function openProjectConversation(
	orgSlug: string,
	projectId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.conversation.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not open the project messages."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not open the project messages.", 0);
	}

	return response.data;
}

export type ProjectConversationResponse = Awaited<
	ReturnType<typeof openProjectConversation>
>;
export type ProjectConversation = ProjectConversationResponse["conversation"];

/** The unread count for the project Messages tab. Never creates the room. */
export async function fetchProjectConversationUnread(
	orgSlug: string,
	projectId: string,
) {
	const response = await api
		.orgs({ orgSlug })
		.projects({ projectId })
		.conversation.unread.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the project messages."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the project messages.", 0);
	}

	return response.data;
}

export type ProjectConversationUnreadResponse = Awaited<
	ReturnType<typeof fetchProjectConversationUnread>
>;
