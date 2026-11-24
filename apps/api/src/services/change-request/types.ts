/**
 * Change request wire shapes.
 *
 * Why this file: the routes and every change request module name the same row
 * and result shapes, so they live together.
 *
 * Used by: every module in `services/change-request/` and
 * `routes/change-requests.ts`.
 */

import type { ChangeRequestStatus } from "../../auth/change-request-permissions";
import type { changeRequest } from "../../db/schema";
import type { MilestoneDetail, MilestoneTimelineComment } from "../milestone";
import type { MilestoneScopeEntrySummary } from "../milestone/scope";
import type { NotificationDelivery } from "../notification.service";

export type ChangeRequestRecord = typeof changeRequest.$inferSelect;

/** One person attached to a request. */
export type ChangeRequestPerson = {
	id: string;
	name: string;
	image: string | null;
};

/** One change request as the Changes tab renders it. */
export type ChangeRequestRow = {
	id: string;
	projectId: string;
	milestoneId: string;
	title: string;
	body: unknown[];
	status: ChangeRequestStatus;
	requestedBy: ChangeRequestPerson | null;
	decidedBy: ChangeRequestPerson | null;
	decidedAt: string | null;
	decisionNote: string | null;
	targetMilestoneId: string | null;
	targetMilestoneTitle: string | null;
	/** The scope section created when this request was accepted, if any. */
	scopeEntryId: string | null;
	createdAt: string;
	updatedAt: string;
	/** True when this caller may still change the title or the body. */
	canEdit: boolean;
	/** True when this caller may pull the request back. */
	canWithdraw: boolean;
};

/** Everything the Changes tab needs in one request. */
export type ChangeRequestListResult = {
	projectId: string;
	milestoneId: string;
	changeRequests: ChangeRequestRow[];
	counts: Record<ChangeRequestStatus, number>;
	openCount: number;
	/** True when the caller may accept, decline or move a request. */
	canDecide: boolean;
};

/** The result every write returns, plus the activity rows to broadcast. */
export type ChangeRequestWriteResult = {
	changeRequest: ChangeRequestRow;
	openCount: number;
	/** The scope section an acceptance added, null for every other write. */
	scopeEntry: MilestoneScopeEntrySummary | null;
	timeline: MilestoneTimelineComment[];
	/** Transport metadata, stripped by the route. */
	notifications: NotificationDelivery[];
};

/** Moving a request also returns the milestone that was created. */
export type ChangeRequestMoveResult = ChangeRequestWriteResult & {
	milestone: MilestoneDetail;
};

/** Public create input. */
export type CreateChangeRequestInput = {
	title: string;
	body?: unknown;
};

/** Public patch input. A patch either edits the text or records a decision. */
export type UpdateChangeRequestInput = {
	title?: string;
	body?: unknown;
	status?: string;
	note?: string | null;
	/** Final accepted section title. Defaults to the request title. */
	scopeTitle?: string;
	/** Final accepted section body. Defaults to the request body. */
	scopeBody?: unknown;
};

/** Public move input. The dialog may override the prefilled title and body. */
export type MoveChangeRequestInput = {
	title?: string;
	description?: unknown;
	status?: string;
	statusNote?: string | null;
	startDate?: string | null;
	dueDate?: string | null;
	estimateMinutes?: number | null;
	assigneeUserIds?: string[];
};
