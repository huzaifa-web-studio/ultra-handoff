/**
 * Milestone deletion.
 *
 * Why this file: deleting a milestone also has to remove the attachment objects
 * that only it referenced, and keep the keys one of its change requests still
 * shares with a surviving milestone. Keeping the row delete and the object walk
 * together is what makes that exception accurate.
 *
 * Used by: `routes/milestones.ts`.
 */

import { and, eq, ne } from "drizzle-orm";

import {
	changeRequest,
	comment,
	milestone,
	milestoneScopeEntry,
} from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { keyFromRichText } from "../../lib/storage";
import type { TenantContext } from "../../middleware/tenant";
import { deleteObjectsBestEffort } from "../upload.service";
import {
	assertUnlocked,
	assertWritable,
	requireMilestoneRecord,
	requireProject,
} from "./access";

/**
 * Permanently delete a milestone. Assignments, comments and change requests
 * cascade with it.
 *
 * Attachments are removed after the commit. Nothing links an object to the
 * row that owns it, so the description, every comment body and every change
 * request body are walked before the delete. The row delete is the source of
 * truth; a storage failure only leaves an orphan for the reconciliation script.
 *
 * One deliberate exception: when a change request was moved into this milestone
 * or into another one, the same attachment key can appear in two living bodies.
 * Keys still referenced by a change request outside this milestone are kept, so
 * deleting the target milestone cannot break the request that asked for it.
 */
export async function deleteMilestone(
	tenant: TenantContext,
	projectId: string,
	milestoneId: string,
): Promise<{ status: "ok" }> {
	const removedKeys = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireProject(tx, tenant, projectId);
			assertWritable(tenant, access);

			const record = await requireMilestoneRecord(
				tx,
				tenant,
				projectId,
				milestoneId,
			);

			// A locked milestone cannot be deleted. Unlock first.
			assertUnlocked(record);

			// One query for every comment in the milestone, rather than one per
			// comment. Event rows carry an empty body and contribute nothing.
			const [
				bodies,
				requestBodies,
				scopeBodies,
				survivingRequestBodies,
				survivingScopeBodies,
				survivingMilestones,
			] = await Promise.all([
				tx
					.select({ body: comment.body })
					.from(comment)
					.where(
						and(
							eq(comment.organizationId, tenant.organizationId),
							eq(comment.milestoneId, milestoneId),
						),
					),
				// Requests on this milestone cascade with it, so their objects go
				// too.
				tx
					.select({ body: changeRequest.body })
					.from(changeRequest)
					.where(
						and(
							eq(changeRequest.organizationId, tenant.organizationId),
							eq(changeRequest.milestoneId, milestoneId),
						),
					),
				// Requests on other milestones survive, so their objects must.
				tx
					.select({ body: changeRequest.body })
					.from(changeRequest)
					.where(
						and(
							eq(changeRequest.organizationId, tenant.organizationId),
							ne(changeRequest.milestoneId, milestoneId),
						),
					),
				// Scope sections belong to this milestone, so they cascade and
				// their attachments go with it.
				tx
					.select({ body: milestoneScopeEntry.body })
					.from(milestoneScopeEntry)
					.where(
						and(
							eq(milestoneScopeEntry.organizationId, tenant.organizationId),
							eq(milestoneScopeEntry.milestoneId, milestoneId),
						),
					),
				// Sections on other milestones survive, including those of a
				// milestone a request was moved into.
				tx
					.select({ body: milestoneScopeEntry.body })
					.from(milestoneScopeEntry)
					.where(
						and(
							eq(milestoneScopeEntry.organizationId, tenant.organizationId),
							eq(milestoneScopeEntry.projectId, projectId),
							ne(milestoneScopeEntry.milestoneId, milestoneId),
						),
					),
				// A moved request shares its attachment keys with the milestone
				// it became. Deleting the source must not pull those bytes out
				// from under the surviving milestone.
				tx
					.select({ description: milestone.description })
					.from(milestone)
					.where(
						and(
							eq(milestone.organizationId, tenant.organizationId),
							eq(milestone.projectId, projectId),
							ne(milestone.id, milestoneId),
						),
					),
			]);

			const keys = keyFromRichText([
				record.description,
				...bodies.map((row) => row.body),
				...requestBodies.map((row) => row.body),
				...scopeBodies.map((row) => row.body),
			]);
			const survivingKeys = new Set([
				...keyFromRichText(survivingRequestBodies.map((row) => row.body)),
				...keyFromRichText(survivingScopeBodies.map((row) => row.body)),
				...keyFromRichText(survivingMilestones.map((row) => row.description)),
			]);

			await tx
				.delete(milestone)
				.where(
					and(
						eq(milestone.organizationId, tenant.organizationId),
						eq(milestone.projectId, projectId),
						eq(milestone.id, milestoneId),
					),
				);

			return keys.filter((key) => !survivingKeys.has(key));
		},
	);

	await deleteObjectsBestEffort(removedKeys);

	return { status: "ok" as const };
}
