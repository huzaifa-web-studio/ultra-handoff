/**
 * Project Messages tab route.
 *
 * Why this file stays thin: it owns the URL contract (`?thread=`) and nothing
 * else. The page component owns the open call and the conversation surface.
 *
 * The thread is a search parameter rather than a path segment so a notification
 * deep link can open the room and its thread in one navigation, and the tab
 * still has one route.
 *
 * Used by: the project workspace layout.
 */

import { createFileRoute } from "@tanstack/react-router";

import { ProjectMessagesPage } from "#/features/projects/messages/project-messages-page";

type ProjectMessagesSearch = {
	/** A root message id from a notification deep link. */
	thread?: string;
};

export const Route = createFileRoute(
	"/_app/$orgSlug/projects/$projectSlug/messages",
)({
	// The value is only a message id, so the shared route validator keeps a hand
	// edited or stale link from reaching the thread request.
	validateSearch: (search: Record<string, unknown>): ProjectMessagesSearch => {
		const thread = search.thread;

		return {
			thread:
				typeof thread === "string" && thread.length > 0 && thread.length <= 64
					? thread
					: undefined,
		};
	},
	component: ProjectMessagesRoute,
	staticData: { breadcrumb: "Messages" },
});

function ProjectMessagesRoute() {
	const { orgSlug, projectSlug } = Route.useParams();
	const { thread } = Route.useSearch();

	return (
		<ProjectMessagesPage
			orgSlug={orgSlug}
			projectSlug={projectSlug}
			threadId={thread ?? null}
		/>
	);
}
