/**
 * Messages index route.
 *
 * Why: the messages layout renders a full width chat. Opening `/messages` with
 * no conversation shows the empty state, which points at the sidebar list.
 *
 * Used by: the app router at `/$orgSlug/messages`.
 */

import { createFileRoute } from "@tanstack/react-router";

import { MessagesEmptyState } from "#/features/messages/messages-empty-state";

export const Route = createFileRoute("/_app/$orgSlug/messages/")({
	component: MessagesIndexRoute,
});

function MessagesIndexRoute() {
	const { orgSlug } = Route.useParams();

	return <MessagesEmptyState orgSlug={orgSlug} />;
}
