/**
 * The read only copy for an archived conversation.
 *
 * Why one helper: the timeline composer, the thread composer and the dedicated
 * thread view all have to say the same thing. The noun follows the scope, so a
 * project room never talks about a channel.
 *
 * Used by: conversation-view.tsx and thread-view.tsx.
 */

/** The sentence shown in place of a composer in an archived conversation. */
export function archivedConversationNotice(
	scope: "direct" | "group" | "project",
): string {
	if (scope === "project") {
		return "This project is archived, so it is read only. Restore the project to continue.";
	}

	if (scope === "group") {
		return "This channel is archived, so it is read only. An owner can restore it from channel settings.";
	}

	return "This conversation is archived, so it is read only.";
}
