/**
 * One conversation timeline route.
 *
 * The conversation layout owns the right pane and this index route renders the
 * main timeline. The thread route below it renders a focused thread instead.
 *
 * Used by: the app router at `/$orgSlug/messages/$conversationId`.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ConversationView } from "#/features/messages/conversation-view";

export const Route = createFileRoute(
	"/_app/$orgSlug/messages/$conversationId/",
)({
	component: ConversationRoute,
});

function ConversationRoute() {
	const { orgSlug, conversationId } = Route.useParams();

	return <ConversationView orgSlug={orgSlug} conversationId={conversationId} />;
}
