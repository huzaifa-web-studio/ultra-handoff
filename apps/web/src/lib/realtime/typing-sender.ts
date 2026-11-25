/**
 * Outbound typing frames.
 *
 * Why two hooks and one shape: a conversation frame travels on the personal
 * socket, a milestone frame on the project socket, but the throttling rule is
 * identical. Both send a start frame at most once every few seconds and a stop
 * frame after a short silence, so a chat with many readers does not become a
 * frame per keystroke.
 *
 * A typing frame is best effort. A closed socket silently drops it, and the
 * next keystroke sends another one. Nothing is stored on the server.
 *
 * Used by: the conversation composer and the milestone comment composer.
 */

import { useCallback, useEffect, useRef } from "react";
import {
	acquireRealtimeSocket,
	acquireUserRealtimeSocket,
	type RealtimeLease,
} from "./socket";

/** Shortest gap between two start frames for one person. */
const THROTTLE_MS = 2_500;

/** How long after the last keystroke a stop frame is sent. */
const STOP_AFTER_MS = 3_000;

type FrameType = "start" | "stop";

function useTypingSender(input: {
	acquire: (() => RealtimeLease) | null;
	buildFrame: (kind: FrameType) => Record<string, unknown>;
}): () => void {
	const leaseRef = useRef<RealtimeLease | null>(null);
	const lastSentRef = useRef(0);
	const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const buildRef = useRef(input.buildFrame);

	useEffect(() => {
		buildRef.current = input.buildFrame;
	});

	useEffect(() => {
		const acquire = input.acquire;

		if (!acquire) return;

		const lease = acquire();
		leaseRef.current = lease;

		return () => {
			if (stopTimerRef.current) clearTimeout(stopTimerRef.current);

			lease.socket.send(buildRef.current("stop"));
			lease.release();
			leaseRef.current = null;
			lastSentRef.current = 0;
		};
		// A new acquire function means a new scope, which needs its own lease.
		// The callers memoize it on the scope values.
	}, [input.acquire]);

	return useCallback(() => {
		const socket = leaseRef.current?.socket;

		if (!socket) return;

		const now = Date.now();

		if (now - lastSentRef.current >= THROTTLE_MS) {
			lastSentRef.current = now;
			socket.send(buildRef.current("start"));
		}

		if (stopTimerRef.current) clearTimeout(stopTimerRef.current);

		stopTimerRef.current = setTimeout(() => {
			socket.send(buildRef.current("stop"));
			lastSentRef.current = 0;
		}, STOP_AFTER_MS);
	}, []);
}

/** Typing inside one direct conversation. */
export function useConversationTypingSender(
	orgSlug: string,
	userId: string,
	conversationId: string,
): () => void {
	const acquire = useCallback(() => {
		return acquireUserRealtimeSocket(orgSlug, userId);
	}, [orgSlug, userId]);

	const buildFrame = useCallback(
		(kind: FrameType) => ({
			type: kind === "start" ? "dm.typing.start" : "dm.typing.stop",
			conversationId,
		}),
		[conversationId],
	);

	return useTypingSender({
		acquire: orgSlug && userId ? acquire : null,
		buildFrame,
	});
}

/** Typing inside one milestone discussion. */
export function useMilestoneTypingSender(
	orgSlug: string,
	projectId: string,
	milestoneId: string,
): () => void {
	const acquire = useCallback(() => {
		return acquireRealtimeSocket(orgSlug, projectId);
	}, [orgSlug, projectId]);

	const buildFrame = useCallback(
		(kind: FrameType) => ({
			type: kind === "start" ? "typing.start" : "typing.stop",
			milestoneId,
		}),
		[milestoneId],
	);

	return useTypingSender({
		acquire: orgSlug && projectId ? acquire : null,
		buildFrame,
	});
}
