"use client";

/**
 * Realtime wiring for the milestone list and detail.
 *
 * Why mounted on the milestones page: that surface owns the list query and the
 * selected milestone. One subscription patches the row, the detail cache and
 * the selection, so a change made in another tab or by another person lands
 * without a refetch.
 *
 * The rich text body is explicitly out of scope. An update broadcasts the
 * summary only, and the client merges it into the detail it already has, so the
 * editor's document is never replaced underneath a writer.
 *
 * Used by: milestone-page.tsx.
 */

import type { MilestoneChangedField, RealtimeEnvelope } from "@org/api";
import { useQueryClient } from "@tanstack/react-query";

import { useRealtimeEvent } from "#/features/realtime/provider";
import type { MilestoneSummary } from "./api";
import { applyMilestoneEvent, type MilestoneRealtimeEvent } from "./hooks";

/** Every field name the server may report as changed. */
const CHANGED_FIELDS: readonly MilestoneChangedField[] = [
	"title",
	"description",
	"status",
	"startDate",
	"dueDate",
	"estimateMinutes",
	"assignees",
];

function isChangedField(value: unknown): value is MilestoneChangedField {
	return (
		typeof value === "string" &&
		(CHANGED_FIELDS as readonly string[]).includes(value)
	);
}

/** Read an object without trusting the transport. */
function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	return value as Record<string, unknown>;
}

/**
 * Validate one frame and return the change it describes.
 *
 * The milestone summary is trusted structurally after the id check. A stale or
 * foreign frame is dropped instead of being applied to the wrong list.
 */
export function readMilestonePayload(
	event: RealtimeEnvelope,
): MilestoneRealtimeEvent | null {
	if (event.type === "milestone.deleted") {
		const milestoneId = asRecord(event.data).milestoneId;

		return typeof milestoneId === "string"
			? { kind: "deleted", milestoneId }
			: null;
	}

	if (
		event.type !== "milestone.created" &&
		event.type !== "milestone.updated"
	) {
		return null;
	}

	const data = asRecord(event.data);
	const milestone = data.milestone;

	if (
		!milestone ||
		typeof milestone !== "object" ||
		Array.isArray(milestone) ||
		typeof (milestone as Record<string, unknown>).id !== "string"
	) {
		return null;
	}

	if (event.type === "milestone.created") {
		return { kind: "created", milestone: milestone as MilestoneSummary };
	}

	if (!Array.isArray(data.changed)) return null;

	return {
		kind: "updated",
		milestone: milestone as MilestoneSummary,
		changed: data.changed.filter(isChangedField),
	};
}

/**
 * Keep the milestone list and the open detail in sync.
 *
 * `onDeleted` lets the page clear the selection when the milestone it is
 * showing was deleted somewhere else.
 */
export function useRealtimeMilestones({
	orgSlug,
	projectId,
	onDeleted,
}: {
	orgSlug: string;
	projectId: string;
	onDeleted: (milestoneId: string) => void;
}): void {
	const queryClient = useQueryClient();

	useRealtimeEvent((event) => {
		if (!projectId) return;

		const payload = readMilestonePayload(event);

		if (!payload) return;

		applyMilestoneEvent(queryClient, orgSlug, projectId, payload);

		if (payload.kind === "deleted") onDeleted(payload.milestoneId);
	});
}
