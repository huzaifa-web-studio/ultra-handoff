/**
 * The messages empty state.
 *
 * Why a route of its own: the messages layout always renders a list and an
 * outlet. Without an index route, `/messages` would render an empty right pane
 * with no explanation.
 *
 * Used by: routes/_app/$orgSlug.messages.index.tsx.
 */

import { MessageSquareIcon } from "lucide-react";

export function MessagesEmptyState() {
	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
			<MessageSquareIcon aria-hidden className="size-8 text-app-text-muted" />
			<p className="text-sm font-medium text-app-text">Select a conversation</p>
			<p className="max-w-xs text-xs text-app-text-muted">
				Pick a chat from the list, or start a new one to message someone in this
				workspace.
			</p>
		</div>
	);
}
