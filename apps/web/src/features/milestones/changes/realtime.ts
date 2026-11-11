"use client";

/**
 * Realtime wiring for milestone change requests.
 *
 * Why invalidate instead of patch: a decision moves a request between status
 * buckets and changes several counts at once. Refetching the short list is
 * cheaper than reproducing that logic in the browser, and the open count is
 * written straight into the milestone detail cache so the tab badge reacts
 * immediately even before the list request returns.
 *
 * Used by: milestone-detail-panel.tsx.
 */

import type { ChangeRequestRealtimePayload, RealtimeEnvelope } from "@org/api";
import { useQueryClient } from "@tanstack/react-query";

import { useRealtimeEvent } from "#/features/realtime/provider";
import { changesKey, patchOpenChangeCount } from "./hooks";

/** Read an object without trusting the transport. */
function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	return value as Record<string, unknown>;
}

/**
 * Validate one frame and return its payload.
 *
 * Redis and the network are outside TypeScript, so a frame is checked before
 * its body reaches a cache. Anything that is not a change request event, or
 * does not carry the fields the tab needs, is ignored.
 */
export function readChangeRequestPayload(
	event: RealtimeEnvelope,
): ChangeRequestRealtimePayload | null {
	if (
		event.type !== "change_request.created" &&
		event.type !== "change_request.updated"
	) {
		return null;
	}

	const data = asRecord(event.data);
	const milestoneId = data.milestoneId;
	const openCount = data.openCount;
	const changeRequest = data.changeRequest;

	if (typeof milestoneId !== "string") return null;
	if (typeof openCount !== "number") return null;
	if (
		!changeRequest ||
		typeof changeRequest !== "object" ||
		Array.isArray(changeRequest) ||
		typeof (changeRequest as Record<string, unknown>).id !== "string"
	) {
		return null;
	}

	return {
		milestoneId,
		openCount,
		changeRequest:
			changeRequest as ChangeRequestRealtimePayload["changeRequest"],
	};
}

/**
 * Keep the open count and the Changes list in sync for the open milestone.
 *
 * The subscription lives on the detail panel, so it is active whether or not
 * the Changes tab has been opened. A request raised in another tab therefore
 * updates the badge even while the reader is on Scope.
 */
export function useRealtimeChangeRequests({
	orgSlug,
	projectId,
	milestoneId,
}: {
	orgSlug: string;
	projectId: string;
	milestoneId: string;
}): void {
	const queryClient = useQueryClient();

	useRealtimeEvent((event) => {
		const payload = readChangeRequestPayload(event);

		if (!payload || payload.milestoneId !== milestoneId) return;

		patchOpenChangeCount(
			queryClient,
			orgSlug,
			projectId,
			milestoneId,
			payload.openCount,
		);

		void queryClient.invalidateQueries({
			queryKey: changesKey(orgSlug, projectId, milestoneId),
		});
	});
}
