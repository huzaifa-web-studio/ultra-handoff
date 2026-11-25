/**
 * Messages index route.
 *
 * Why: the layout renders the list and an outlet, so `/messages` needs a right
 * pane that explains how to open a chat.
 *
 * Used by: the app router at `/$orgSlug/messages`.
 */

import { createFileRoute } from "@tanstack/react-router";

import { MessagesEmptyState } from "#/features/messages/messages-empty-state";

export const Route = createFileRoute("/_app/$orgSlug/messages/")({
	component: MessagesEmptyState,
});
