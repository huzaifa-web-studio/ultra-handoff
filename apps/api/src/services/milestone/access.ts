/**
 * Milestone access and write guards.
 *
 * Why this file: the rules that decide whether a caller may see or change a
 * milestone must be identical for every operation. They live here and every
 * other module in the folder calls them, so no write path can skip a check.
 *
 * Reads delegate project visibility to `loadProjectAccess`, so a milestone can
 * never leak through a project the caller cannot open.
 *
 * Used by: all read and write modules in `services/milestone/`, plus
 * `services/comment.service.ts` and `services/comment-read.service.ts` through
 * `requireMilestoneAccess`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { canCommentOnProject } from "../../auth/comment-permissions";
import {
	canLockMilestones,
	canWriteMilestones,
	canWriteReviewScope,
	canWriteTestScope,
	MILESTONE_LOCKED_MESSAGE,
} from "../../auth/milestone-permissions";
import { assertProjectActive } from "../../auth/project-permissions";
import { milestone } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";
import { loadProjectAccess, type ProjectAccess } from "../project.service";
import type { MilestoneRecord, MilestoneViewer } from "./types";

/** Build the viewer capabilities from the project access the caller has. */
export function toViewer(
	tenant: TenantContext,
	access: ProjectAccess,
	status?: string,
): MilestoneViewer {
	const archived = access.row.archivedAt !== null;
	const staff = canWriteMilestones(tenant.role, access.role);

	return {
		userId: tenant.userId,
		canWrite: !archived && staff,
		// Ticking a checklist item is progress, so it is allowed on a locked
		// milestone. It still stops when the whole project is archived.
		canTickChecklist: !archived && staff,
		canComment: !archived && canCommentOnProject(tenant.role, access.role),
		canLock: !archived && canLockMilestones(tenant.role, access.role),
		// The phase flags matter only on a detail response, where the status
		// is known. A list response leaves them false on purpose.
		canWriteTestScope:
			!archived &&
			status !== undefined &&
			canWriteTestScope(tenant.role, access.role, status),
		canWriteReviewScope:
			!archived &&
			status !== undefined &&
			canWriteReviewScope(tenant.role, access.role, status),
		archived,
	};
}

/**
 * Load the project and fail with 404 when the caller cannot see it.
 *
 * Why 404 and not 403: the project visibility rule already answers "not found"
 * for hidden projects, and reusing it means a milestone endpoint cannot be used
 * to discover that a project exists.
 */
export async function requireProject(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
): Promise<ProjectAccess> {
	const access = await loadProjectAccess(tx, tenant, projectId);

	if (!access) {
		throw new APIError("NOT_FOUND", {
			message: "That project no longer exists.",
		});
	}

	return access;
}

/**
 * Reject a write from someone who may not write, or on a locked project.
 *
 * The archived check comes first because it is a lifecycle rule that applies to
 * every role, including owners.
 */
export function assertWritable(
	tenant: TenantContext,
	access: ProjectAccess,
): void {
	assertProjectActive(access.row.archivedAt);

	if (!canWriteMilestones(tenant.role, access.role)) {
		throw new APIError("FORBIDDEN", {
			message: "You can review milestones but not change them.",
		});
	}
}

/**
 * Reject a write while the milestone is locked.
 *
 * The lock freezes the agreed document and its fields: title, scope, dates,
 * estimate and the delete action. Status, assignees and checklist ticks are
 * progress against that document, so they stay available to staff and do not
 * call this guard.
 */
export function assertUnlocked(record: MilestoneRecord): void {
	if (record.lockedAt !== null) {
		throw new APIError("BAD_REQUEST", { message: MILESTONE_LOCKED_MESSAGE });
	}
}

/** Load one milestone inside a project and lock its row for a write. */
export async function requireMilestoneRecordForUpdate(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<MilestoneRecord> {
	const [record] = await tx
		.select()
		.from(milestone)
		.where(
			and(
				eq(milestone.organizationId, tenant.organizationId),
				eq(milestone.projectId, projectId),
				eq(milestone.id, milestoneId),
			),
		)
		.limit(1)
		.for("update");

	if (!record) {
		throw new APIError("NOT_FOUND", {
			message: "That milestone no longer exists.",
		});
	}

	return record;
}

/** Load one milestone inside a project, or fail with 404. */
export async function requireMilestoneRecord(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<MilestoneRecord> {
	const [record] = await tx
		.select()
		.from(milestone)
		.where(
			and(
				eq(milestone.organizationId, tenant.organizationId),
				eq(milestone.projectId, projectId),
				eq(milestone.id, milestoneId),
			),
		)
		.limit(1);

	if (!record) {
		throw new APIError("NOT_FOUND", {
			message: "That milestone no longer exists.",
		});
	}

	return record;
}

/**
 * True when a milestone belongs to the given project inside the organization.
 *
 * Why a boolean and not the record: the realtime gateway only needs to know
 * whether a `presence.join` frame names a milestone the socket may observe. It
 * already proved project access at upgrade, so this is the one extra check that
 * stops a frame from subscribing to another project's milestone.
 */
export async function milestoneExistsInProject(
	tx: TenantTx,
	organizationId: string,
	projectId: string,
	milestoneId: string,
): Promise<boolean> {
	const [row] = await tx
		.select({ id: milestone.id })
		.from(milestone)
		.where(
			and(
				eq(milestone.organizationId, organizationId),
				eq(milestone.projectId, projectId),
				eq(milestone.id, milestoneId),
			),
		)
		.limit(1);

	return Boolean(row);
}

/**
 * Load the project access and the milestone in one call.
 *
 * Why exported: the comment service needs exactly the same two answers before
 * it may touch a thread. Sharing the helper means a comment can never be
 * reachable through a milestone the caller cannot open, and the 404 wording is
 * identical on both surfaces.
 */
export async function requireMilestoneAccess(
	tx: TenantTx,
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<{ access: ProjectAccess; milestone: MilestoneRecord }> {
	const access = await requireProject(tx, tenant, projectId);
	const record = await requireMilestoneRecord(
		tx,
		tenant,
		projectId,
		milestoneId,
	);

	return { access, milestone: record };
}
