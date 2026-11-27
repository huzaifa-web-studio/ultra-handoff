/**
 * Realtime wiring for the project Messages tab dot.
 *
 * Why this exists separately from the conversation pane: the dot lives in the
 * tab row, which is mounted before the tab is opened. It only needs the personal
 * stream, so it stays a tiny subscriber instead of pulling in the whole message
 * cache patcher.
 *
 * Used by: features/projects/project-workspace.tsx.
 */

import type { RealtimeEnvelope } from "@org/api";
import { useQueryClient } from "@tanstack/react-query";

import { useUserRealtimeEvent } from "#/lib/realtime/user-events";
import { projectConversationUnreadKey } from "./hooks";

/** Read the conversation id out of a personal conversation event. */
function readConversationId(event: RealtimeEnvelope): string | null {
	if (
		event.type !== "conversation.message.created" &&
		event.type !== "conversation.read"
	) {
		return null;
	}

	const data = event.data;

	if (!data || typeof data !== "object" || Array.isArray(data)) return null;

	const value = (data as Record<string, unknown>).conversationId;

	return typeof value === "string" ? value : null;
}

/**
 * Refresh the project tab dot whenever its room changes.
 *
 * A message in the room makes the dot appear, and the viewer's own read cursor
 * move in any tab clears it. Any other conversation is ignored, so a busy
 * direct chat does not refetch every project badge.
 */
export function useProjectMessagesBadge(input: {
	orgSlug: string;
	projectId: string | null;
	conversationId: string | null;
}): void {
	const queryClient = useQueryClient();
	const { orgSlug, projectId, conversationId } = input;

	useUserRealtimeEvent((event) => {
		if (!orgSlug || !projectId || !conversationId) return;

		if (readConversationId(event) !== conversationId) return;

		void queryClient.invalidateQueries({
			queryKey: projectConversationUnreadKey(orgSlug, projectId),
		});
	});
}
