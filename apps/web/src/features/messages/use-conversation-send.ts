/**
 * Pending sends and retry for one conversation.
 *
 * Why extracted: the view was already past the file size target, and this logic
 * is self contained. Keeping it here also means the optimistic row rules are
 * stated once instead of mixed into the layout.
 *
 * A failed send keeps its row so it can be retried with the same nonce. Sending
 * the same body again reuses that nonce, which is what stops a retry from being
 * stored twice.
 *
 * Used by: features/messages/conversation-view.tsx.
 */

import { useCallback, useState } from "react";

import type { PendingMessage } from "./message-item";

/** The part of the send mutation this hook uses. */
type SendMutation = {
	mutateAsync: (input: {
		body: unknown[];
		clientNonce: string;
		parentId?: string | null;
	}) => Promise<unknown>;
};

export function useConversationSend(send: SendMutation) {
	const [pending, setPending] = useState<PendingMessage[]>([]);

	const handleSend = useCallback(
		async (body: unknown[]) => {
			const failed = pending.find(
				(item) =>
					item.failed && JSON.stringify(item.body) === JSON.stringify(body),
			);
			const nonce = failed?.nonce ?? crypto.randomUUID();

			if (failed) {
				setPending((current) =>
					current.map((item) =>
						item.nonce === nonce ? { ...item, failed: false } : item,
					),
				);
			} else {
				setPending((current) => [...current, { nonce, body, failed: false }]);
			}

			try {
				await send.mutateAsync({ body, clientNonce: nonce });
				setPending((current) => current.filter((item) => item.nonce !== nonce));
			} catch (error) {
				setPending((current) =>
					current.map((item) =>
						item.nonce === nonce ? { ...item, failed: true } : item,
					),
				);

				// The composer keeps the draft when the send rejects.
				throw error;
			}
		},
		[pending, send],
	);

	const retryPending = useCallback(
		async (nonce: string) => {
			const item = pending.find((entry) => entry.nonce === nonce);

			if (!item) return;

			setPending((current) =>
				current.map((entry) =>
					entry.nonce === nonce ? { ...entry, failed: false } : entry,
				),
			);

			try {
				await send.mutateAsync({
					body: item.body,
					clientNonce: nonce,
				});
				setPending((current) =>
					current.filter((entry) => entry.nonce !== nonce),
				);
			} catch {
				setPending((current) =>
					current.map((entry) =>
						entry.nonce === nonce ? { ...entry, failed: true } : entry,
					),
				);
			}
		},
		[pending, send],
	);

	return { pending, handleSend, retryPending };
}
