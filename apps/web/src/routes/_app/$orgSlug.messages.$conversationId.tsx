/**
 * One conversation route.
 *
 * Why a real URL per conversation: a chat can be opened in a new browser tab,
 * deep linked from a notification, and closed with the back button.
 *
 * Used by: the app router at `/$orgSlug/messages/$conversationId`.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ConversationView } from "#/features/messages/conversation-view";

export const Route = createFileRoute("/_app/$orgSlug/messages/$conversationId")(
	{
		component: ConversationRoute,
	},
);

function ConversationRoute() {
	const { orgSlug, conversationId } = Route.useParams();

	return <ConversationView orgSlug={orgSlug} conversationId={conversationId} />;
}
