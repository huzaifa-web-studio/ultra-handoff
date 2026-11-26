/**
 * Conversation layout route.
 *
 * Why a layout: the conversation view and a focused thread are two states of
 * the same right pane. The index route renders the timeline, and the nested
 * thread route renders the thread. Without this outlet the thread URL would
 * match the parent and render the timeline.
 *
 * Used by: the app router at `/$orgSlug/messages/$conversationId`.
 */

import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/$orgSlug/messages/$conversationId")(
	{
		component: ConversationLayout,
	},
);

function ConversationLayout() {
	return <Outlet />;
}
