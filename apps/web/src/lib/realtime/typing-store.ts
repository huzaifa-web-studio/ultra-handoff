/**
 * Ephemeral typing state.
 *
 * Why a store outside React: typing frames arrive on one socket and are read by
 * two different features (comments and messages). A module level store with an
 * expiry keeps the frame frequency away from the React tree, and an entry that
 * never receives a stop frame disappears on its own.
 *
 * A channel can have several typers at once, so each channel keeps a map of
 * person to expiry. Snapshots are cached per channel because
 * `useSyncExternalStore` compares the value by reference and a fresh array on
 * every render would loop.
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

/** Expiry per person, keyed by channel then user id. */
const entries = new Map<string, Map<string, number>>();
/** One expiry timer per channel and person. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** A stable snapshot array per channel, for `useSyncExternalStore`. */
const snapshots = new Map<string, readonly string[]>();
const EMPTY: readonly string[] = [];
const listeners = new Set<() => void>();

/** A channel key for one conversation. */
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

function timerKey(channel: string, userId: string): string {
	return `${channel}\u0000${userId}`;
}

/** Refresh the cached array for one channel, replacing it only on a change. */
function refreshSnapshot(channel: string): void {
	const channelEntries = entries.get(channel);
	const next = channelEntries ? [...channelEntries.keys()] : [];
	const previous = snapshots.get(channel);

	if (
		!previous ||
		previous.length !== next.length ||
		previous.some((value, index) => value !== next[index])
	) {
		snapshots.set(channel, next);
	}
}

function clearTimer(channel: string, userId: string): void {
	const key = timerKey(channel, userId);
	const timer = timers.get(key);

	if (timer) {
		clearTimeout(timer);
		timers.delete(key);
	}
}

/** Drop expired entries for one channel. Returns true when something expired. */
function pruneChannel(channel: string): boolean {
	const channelEntries = entries.get(channel);

	if (!channelEntries) return false;

	let changed = false;
	const now = Date.now();

	for (const [userId, expiresAt] of channelEntries) {
		if (expiresAt > now) continue;

		channelEntries.delete(userId);
		changed = true;
	}

	if (channelEntries.size === 0) entries.delete(channel);

	if (changed) refreshSnapshot(channel);

	return changed;
}

/** Record that a person is typing in a channel. */
export function setTyping(channel: string, userId: string): void {
	const channelEntries = entries.get(channel) ?? new Map<string, number>();

	channelEntries.set(userId, Date.now() + TYPING_TTL_MS);
	entries.set(channel, channelEntries);
	refreshSnapshot(channel);

	clearTimer(channel, userId);
	timers.set(
		timerKey(channel, userId),
		setTimeout(() => {
			const current = entries.get(channel);

			// Only expire the frame this timer was scheduled for.
			if (current?.has(userId)) {
				const expiresAt = current.get(userId) ?? 0;

				if (expiresAt <= Date.now()) {
					current.delete(userId);
					timers.delete(timerKey(channel, userId));

					if (current.size === 0) entries.delete(channel);

					refreshSnapshot(channel);
					emit();
				}
			}
		}, TYPING_TTL_MS),
	);

	emit();
}

/** Clear one person's typing entry, or the whole channel when no id is given. */
export function clearTyping(channel: string, userId?: string): void {
	const channelEntries = entries.get(channel);

	if (!channelEntries) return;

	if (userId) {
		if (!channelEntries.has(userId)) return;

		channelEntries.delete(userId);
		clearTimer(channel, userId);
	} else {
		entries.delete(channel);

		for (const key of [...timers.keys()]) {
			if (!key.startsWith(`${channel}\u0000`)) continue;

			const timer = timers.get(key);

			if (timer) clearTimeout(timer);

			timers.delete(key);
		}
	}

	if (channelEntries.size === 0) entries.delete(channel);

	refreshSnapshot(channel);
	emit();
}

/** Everyone typing in a channel, in arrival order. */
export function typingUsers(channel: string): readonly string[] {
	pruneChannel(channel);

	return snapshots.get(channel) ?? EMPTY;
}

/** The first person typing in a channel, or null. */
export function typingUser(channel: string): string | null {
	return typingUsers(channel)[0] ?? null;
}

/** Subscribe to typing changes. */
export function subscribeTyping(listener: () => void): () => void {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}

/**
 * Everyone typing in a channel, as a React value.
 *
 * The snapshot is cached per channel, so a frame only re-renders a header that
 * shows the indicator. Server rendering returns an empty list, matching the
 * client's first frame.
 */
export function useTypingUsers(channel: string): readonly string[] {
	return useSyncExternalStore(
		subscribeTyping,
		() => typingUsers(channel),
		() => EMPTY,
	);
}

/** The first person typing in a channel, as a React value. */
export function useTypingUser(channel: string): string | null {
	return useSyncExternalStore(
		subscribeTyping,
		() => typingUser(channel),
		() => null,
	);
}
