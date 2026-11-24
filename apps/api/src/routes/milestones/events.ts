/**
 * Milestone realtime publishers.
 *
 * Why this file: every write handler broadcasts the same event shapes, so the
 * publishers and the list query parser live together.
 *
 * Used by: `routes/milestones/index.ts`.
 */

import { publishRealtimeEvent } from "../../realtime";
import {
	type CommentRealtimePayload,
	type MilestoneChangedField,
	type MilestoneCreatedPayload,
	type MilestoneDeletedPayload,
	type MilestoneScopeChangedPayload,
	type MilestoneUpdatedPayload,
	toRealtimeMilestone,
} from "../../realtime/events";
import type {
	MilestoneListQuery,
	MilestoneSummary,
	MilestoneTimelineComment,
} from "../../services/milestone";
import { MILESTONE_FILTERS, MILESTONE_SORTS } from "./schemas";

export function parseMilestoneQuery(query: {
	search?: string;
	status?: string;
	sort?: string;
	direction?: string;
	page?: string;
	pageSize?: string;
}): MilestoneListQuery {
	const status = (MILESTONE_FILTERS as readonly string[]).includes(
		query.status ?? "",
	)
		? (query.status as MilestoneListQuery["status"])
		: "active";

	const sort = (MILESTONE_SORTS as readonly string[]).includes(query.sort ?? "")
		? (query.sort as MilestoneListQuery["sort"])
		: "dueDate";

	const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
	const pageSize = Math.min(
		50,
		Math.max(10, Number.parseInt(query.pageSize ?? "25", 10) || 25),
	);

	return {
		search: query.search ?? "",
		status,
		sort,
		direction: query.direction === "desc" ? "desc" : "asc",
		page,
		pageSize,
	};
}

/**
 * Publish a milestone change.
 *
 * Why the routes and not the service: each helper needs the project id from the
 * URL, and a realtime failure must never turn a successful save into an error.
 * `publishRealtimeEvent` never rejects, so these are fire and forget.
 */
export function publishMilestoneCreated(
	projectId: string,
	milestone: MilestoneSummary,
): void {
	const payload: MilestoneCreatedPayload = {
		milestone: toRealtimeMilestone(milestone),
	};

	void publishRealtimeEvent(projectId, "milestone.created", payload).catch(
		() => undefined,
	);
}

export function publishMilestoneUpdated(
	projectId: string,
	milestone: MilestoneSummary,
	changed: MilestoneChangedField[],
	timeline: MilestoneTimelineComment[],
): void {
	const payload: MilestoneUpdatedPayload = {
		milestone: toRealtimeMilestone(milestone),
		changed,
	};

	void publishRealtimeEvent(projectId, "milestone.updated", payload).catch(
		() => undefined,
	);

	// Activity rows ride the comment channel, so the discussion shows the status
	// and date changes without a refetch. An event is not a message, so the
	// visible comment count is left alone.
	for (const comment of timeline) {
		const commentPayload: CommentRealtimePayload = {
			milestoneId: milestone.id,
			comment,
			total: null,
		};

		void publishRealtimeEvent(
			projectId,
			"comment.created",
			commentPayload,
		).catch(() => undefined);
	}
}

export function publishMilestoneDeleted(
	projectId: string,
	milestoneId: string,
): void {
	const payload: MilestoneDeletedPayload = { milestoneId };

	void publishRealtimeEvent(projectId, "milestone.deleted", payload).catch(
		() => undefined,
	);
}

/**
 * Tell open panes that one scope section changed.
 *
 * Deliberately lighter than a milestone update: the payload carries ids only,
 * so a reader fetches the one body it is looking at instead of the whole
 * detail. The section body never travels on the realtime channel.
 */
export function publishScopeChanged(
	projectId: string,
	milestoneId: string,
	entryId: string,
	updatedBy: string,
): void {
	const payload: MilestoneScopeChangedPayload = {
		milestoneId,
		entryId,
		updatedBy,
	};

	void publishRealtimeEvent(
		projectId,
		"milestone.scope.changed",
		payload,
	).catch(() => undefined);
}
