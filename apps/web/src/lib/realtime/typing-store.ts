/**
 * Ephemeral typing state.
 *
 * Why a store outside React: typing frames arrive on one socket and are read by
 * two different features (comments and messages). A module level store with an
 * expiry keeps the frame frequency away from the React tree, and an entry that
 * never receives a stop frame disappears on its own.
 *
 * Nothing is persisted or sent to the server. A typing indicator is a hint, not
 * data.
 *
 * Used by: features/messages/realtime.ts, the conversation header and the
 * milestone comments tab.
 */

import { useSyncExternalStore } from "react";

/** How long a typing entry survives without a fresh frame. */
const TYPING_TTL_MS = 4_000;

type Entry = { userId: string; expiresAt: number };

const entries = new Map<string, Entry>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

/** A channel key for one direct conversation. */
export function conversationChannel(conversationId: string): string {
	return `conversation:${conversationId}`;
}

/** A channel key for one milestone discussion. */
export function milestoneChannel(
	projectId: string,
	milestoneId: string,
): string {
	return `milestone:${projectId}:${milestoneId}`;
}

function emit(): void {
	for (const listener of [...listeners]) {
		try {
			listener();
		} catch {
			// One broken subscriber must not stop the rest.
		}
	}
}

function clearTimer(channel: string): void {
	const timer = timers.get(channel);

	if (timer) {
		clearTimeout(timer);
		timers.delete(channel);
	}
}

/** Record that a person is typing in a channel. */
export function setTyping(channel: string, userId: string): void {
	entries.set(channel, { userId, expiresAt: Date.now() + TYPING_TTL_MS });

	clearTimer(channel);
	timers.set(
		channel,
		setTimeout(() => {
			const entry = entries.get(channel);

			// Only expire the frame that scheduled this timer.
			if (entry?.userId === userId) {
				entries.delete(channel);
				timers.delete(channel);
				emit();
			}
		}, TYPING_TTL_MS),
	);

	emit();
}

/** Clear a typing entry. A stop from a different person is ignored. */
export function clearTyping(channel: string, userId?: string): void {
	const entry = entries.get(channel);

	if (!entry) return;
	if (userId && entry.userId !== userId) return;

	entries.delete(channel);
	clearTimer(channel);
	emit();
}

/** The person typing in a channel, or null. */
export function typingUser(channel: string): string | null {
	const entry = entries.get(channel);

	if (!entry) return null;

	if (entry.expiresAt <= Date.now()) {
		entries.delete(channel);
		clearTimer(channel);

		return null;
	}

	return entry.userId;
}

/** Subscribe to typing changes. */
export function subscribeTyping(listener: () => void): () => void {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}

/**
 * The person typing in a channel, as a React value.
 *
 * `useSyncExternalStore` is the right primitive here: the store lives outside
 * React and the snapshot is a primitive, so a frame only re-renders the header
 * that shows it.
 */
export function useTypingUser(channel: string): string | null {
	return useSyncExternalStore(
		subscribeTyping,
		() => typingUser(channel),
		() => null,
	);
}
