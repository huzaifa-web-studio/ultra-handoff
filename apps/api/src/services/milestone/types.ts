/**
 * Milestone wire shapes.
 *
 * Why this file: every other module in the folder reads and writes these
 * shapes, and the route layer imports them for its response types. Keeping them
 * in one place means a payload change is a single edit, and no module has to
 * depend on a sibling just to name a type.
 *
 * These are the exact types the old `milestone.service.ts` exported, with no
 * field changes.
 *
 * Used by: every module in `services/milestone/` and by `routes/milestones.ts`.
 */

import type { MilestoneStatus } from "../../auth/milestone-permissions";
import type { comment, milestone } from "../../db/schema";
import type { MilestoneEventDraft } from "../../lib/milestone-events";
import type { MilestoneChangedField } from "../../realtime/events";
import type { MilestoneScopeEntrySummary } from "../milestone/scope";
import type { MilestonePhaseSummary } from "../milestone-phase.service";
import type { NotificationDelivery } from "../notification.service";

/** One person assigned to a milestone. */
export type MilestoneAssigneeRow = {
	userId: string;
	memberId: string;
	name: string;
	image: string | null;
};

/** One row the milestone list renders. Deliberately without the full body. */
export type MilestoneSummary = {
	id: string;
	projectId: string;
	title: string;
	status: MilestoneStatus;
	startDate: string | null;
	dueDate: string | null;
	estimateMinutes: number | null;
	assignees: MilestoneAssigneeRow[];
	/** Null while unlocked. Both fields move together. */
	lockedAt: string | null;
	lockedByName: string | null;
	/** How many change requests on this milestone are still open. */
	openChangeRequestCount: number;
	completedAt: string | null;
	createdBy: string | null;
	createdByName: string | null;
	updatedBy: string | null;
	updatedByName: string | null;
	createdAt: string;
	updatedAt: string;
};

/** The summary plus the full editor document. */
export type MilestoneDetail = MilestoneSummary & {
	description: unknown[];
	/** Named scope additions under the initial scope, without bodies. */
	scopeEntries: MilestoneScopeEntrySummary[];
	/** Every recorded status period and the derived durations. */
	phase: MilestonePhaseSummary;
};

/** Capabilities of the caller, so the UI never guesses from a role string. */
export type MilestoneViewer = {
	/** The caller's user id, so the UI can tell their own edits from another's. */
	userId: string;
	/** True when the caller may create, edit, assign and delete. */
	canWrite: boolean;
	/**
	 * True when the caller may tick a scope checklist item.
	 *
	 * Deliberately separate from `canWrite`: a tick is progress, and progress
	 * survives the lock, so this stays true for staff on a locked milestone.
	 */
	canTickChecklist: boolean;
	/**
	 * True when the caller may post in the discussion.
	 *
	 * Deliberately separate from `canWrite`: a client cannot author milestones
	 * but is a full participant in the conversation about them.
	 */
	canComment: boolean;
	/** True when the caller may lock or unlock this milestone. */
	canLock: boolean;
	/**
	 * True when the caller may write the current testing round.
	 *
	 * Phase and role are both part of the answer, so the UI never has to
	 * re-derive "am I staff and is this testing".
	 */
	canWriteTestScope: boolean;
	/** True when the caller may write the current review round. */
	canWriteReviewScope: boolean;
	/** True when the project is archived and every write is refused. */
	archived: boolean;
};

/** Per status totals for the filter chips. */
export type MilestoneCounts = {
	all: number;
	active: number;
	todo: number;
	inDevelopment: number;
	inTesting: number;
	ready: number;
	inReview: number;
	blocked: number;
	done: number;
	cancelled: number;
};

/** Everything the milestone tab needs in one request. */
export type MilestoneListResult = {
	organizationId: string;
	projectId: string;
	milestones: MilestoneSummary[];
	viewer: MilestoneViewer;
	counts: MilestoneCounts;
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
};

/** One milestone plus the caller's capabilities. */
export type MilestoneDetailResult = {
	projectId: string;
	milestone: MilestoneDetail;
	viewer: MilestoneViewer;
};

/** A write that also produced notifications, stripped by the route. */
export type MilestoneWriteResult = MilestoneDetailResult & {
	notifications: NotificationDelivery[];
};

/** One timeline row written by a milestone update, in broadcast shape. */
export type MilestoneTimelineComment = {
	id: string;
	parentId: null;
	kind: "event";
	event: {
		type: MilestoneEventDraft["type"];
		from: string | null;
		to: string | null;
		note: string | null;
	};
	body: unknown[];
	author: { id: string; name: string; image: string | null };
	createdAt: string;
	updatedAt: string;
	editedAt: null;
	deletedAt: null;
};

/**
 * The update result plus what the route needs to broadcast.
 *
 * `changed` lets the client decide between patching a row and refetching the
 * list. `timeline` carries the activity rows the update wrote, so the
 * discussion shows them without a refetch.
 */
export type MilestoneUpdateResult = MilestoneDetailResult & {
	changed: MilestoneChangedField[];
	timeline: MilestoneTimelineComment[];
	notifications: NotificationDelivery[];
};

/** Normalised list filters, parsed and clamped by the route. */
export type MilestoneListQuery = {
	search: string;
	status: MilestoneStatus | "all" | "active";
	sort: "dueDate" | "createdAt" | "title";
	direction: "asc" | "desc";
	page: number;
	pageSize: number;
};

/** Public create input. */
export type CreateMilestoneInput = {
	title: string;
	description?: unknown;
	status?: string;
	/** Required when the milestone is created already blocked. */
	statusNote?: string | null;
	startDate?: string | null;
	dueDate?: string | null;
	estimateMinutes?: number | null;
	assigneeUserIds?: string[];
};

/** Public update input. Every field is optional, which is what autosave sends. */
export type UpdateMilestoneInput = {
	title?: string;
	description?: unknown;
	status?: string;
	/** Required when the status becomes blocked. */
	statusNote?: string | null;
	startDate?: string | null;
	dueDate?: string | null;
	estimateMinutes?: number | null;
	assigneeUserIds?: string[];
};

/** One scope checklist tick. */
export type ToggleMilestoneChecklistInput = {
	itemId: string;
	checked: boolean;
};

/** A database row, before it is mapped to the wire shape. */
export type MilestoneRecord = typeof milestone.$inferSelect;

/** A database row from the comment table, used for the activity timeline. */
export type CommentRecord = typeof comment.$inferSelect;
