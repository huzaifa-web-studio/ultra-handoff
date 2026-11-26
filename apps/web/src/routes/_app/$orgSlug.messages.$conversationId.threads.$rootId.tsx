/**
 * One focused message thread route.
 *
 * Why a real URL per thread: it opens in a new browser tab, survives a reload
 * and can be linked from a search hit. The conversation list lives in the
 * messages layout, so this route only owns the right pane.
 *
 * Used by: the app router at
 * `/$orgSlug/messages/$conversationId/threads/$rootId`.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ThreadView } from "#/features/messages/thread-view";

/** The search hit to scroll to after the thread opens. */
type ThreadSearch = { message?: string };

export const Route = createFileRoute(
	"/_app/$orgSlug/messages/$conversationId/threads/$rootId",
)({
	validateSearch: (search: Record<string, unknown>): ThreadSearch => ({
		message:
			typeof search.message === "string" &&
			search.message.length > 0 &&
			search.message.length <= 64
				? search.message
				: undefined,
	}),
	component: ThreadRoute,
});

function ThreadRoute() {
	const { orgSlug, conversationId, rootId } = Route.useParams();
	const { message } = Route.useSearch();

	return (
		<ThreadView
			orgSlug={orgSlug}
			conversationId={conversationId}
			rootId={rootId}
			initialMessageId={message ?? null}
		/>
	);
}
