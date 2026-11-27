/**
 * Move the read cursor only while the conversation is actually visible.
 *
 * Why extracted: a background tab must never consume a notification the person
 * did not see. The rule is small but easy to lose inside a large view, and the
 * messages page and the project Messages tab share it.
 *
 * Used by: features/messages/conversation-view.tsx.
 */

import { useEffect, useRef } from "react";

/** The part of the read mutation this hook uses. */
type ReadMutation = {
	mutate: (id: string, options?: { onError?: () => void }) => void;
};

export function useConversationReadOnVisible(
	newestId: string | null,
	markRead: ReadMutation,
): void {
	const newestRef = useRef<string | null>(null);
	const markedRef = useRef<string | null>(null);
	const markReadRef = useRef(markRead);

	useEffect(() => {
		markReadRef.current = markRead;
	}, [markRead]);

	useEffect(() => {
		newestRef.current = newestId;

		function attempt() {
			const id = newestRef.current;

			if (!id || markedRef.current === id) return;
			if (document.visibilityState !== "visible") return;

			markedRef.current = id;
			markReadRef.current.mutate(id, {
				onError: () => {
					markedRef.current = null;
				},
			});
		}

		attempt();
		document.addEventListener("visibilitychange", attempt);

		return () => document.removeEventListener("visibilitychange", attempt);
	}, [newestId]);
}
