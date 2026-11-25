/**
 * Messages layout route.
 *
 * Why a layout: the conversation list stays mounted while a chat opens, so a
 * reply does not reset the list, and the open chat is its own URL below it.
 *
 * Used by: the app router at `/$orgSlug/messages`.
 */

import { createFileRoute } from "@tanstack/react-router";

import { MessagesShell } from "#/features/messages/messages-shell";

export const Route = createFileRoute("/_app/$orgSlug/messages")({
	component: MessagesLayout,
	staticData: { breadcrumb: "Messages" },
});

function MessagesLayout() {
	const { orgSlug } = Route.useParams();

	return <MessagesShell orgSlug={orgSlug} />;
}
