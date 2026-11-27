/**
 * Opening and reading a project conversation room.
 *
 * Why this file: a project room is created on first open instead of on project
 * create. Existing projects therefore need no backfill, and a project that
 * never used messages keeps no empty room. Opening is idempotent: the room id
 * is derived from the project id and a partial unique index backs it, so two
 * tabs opening at once land on the same row.
 *
 * The participant set mirrors the project Overview: explicit project members
 * plus organization owners, who always own every project. A person who can see
 * the project can open the room.
 *
 * Used by: `routes/projects/messages.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq, isNull } from "drizzle-orm";

import {
	conversation,
	conversationParticipant,
	projectMember,
} from "../../../db/schema";
import type { TenantTx } from "../../../db/tenant";
import { withTenant } from "../../../db/tenant";
import type { TenantContext } from "../../../middleware/tenant";
import { listOrganizationOwners } from "../../organization.service";
import { loadProjectAccess } from "../../project/access";
import { loadPeople } from "../access";
import { buildConversationSummary, countConversationUnread } from "../list";
import type { ConversationSummary } from "../types";
import {
	countActiveParticipants,
	findProjectRoom,
	type ProjectParticipantInput,
	syncProjectParticipants,
	toProjectConversationRole,
	upsertProjectParticipant,
	writeMemberCount,
} from "./sync";

/**
 * The room id for one project.
 *
 * Derived rather than random so a concurrent open has no row to look up before
 * the caller is a participant. Project ids are UUIDs, so the prefix cannot
 * collide with a random direct or channel id.
 */
export function projectConversationId(projectId: string): string {
	return `project-${projectId}`;
}

/** One open room, plus the people the route may fan out to. */
export type ProjectConversationResult = {
	conversation: ConversationSummary;
	participantIds: string[];
};

/** An unread read that never creates a room. */
export type ProjectConversationUnread = {
	conversationId: string | null;
	unread: number;
};

/**
 * Build the participant entries from the project member rows and the workspace
 * owners. Organization owners win the role so the roster matches the Overview.
 */
function buildParticipantEntries(
	tenant: TenantContext,
	accessRole: string,
	memberRows: Array<{ userId: string; role: string }>,
	ownerIds: string[],
): ProjectParticipantInput[] {
	const byUser = new Map<string, ProjectParticipantInput>();

	for (const row of memberRows) {
		byUser.set(row.userId, {
			userId: row.userId,
			role: toProjectConversationRole(row.role),
		});
	}

	for (const userId of ownerIds) {
		byUser.set(userId, { userId, role: "owner" });
	}

	// Defensive: `loadProjectAccess` can grant access through the organization
	// owner rule even when both reads are momentarily stale. The caller must
	// always be able to enter the room they just opened.
	if (!byUser.has(tenant.userId)) {
		byUser.set(tenant.userId, {
			userId: tenant.userId,
			role: toProjectConversationRole(accessRole),
		});
	}

	return [...byUser.values()];
}

/** Read the current project members through the tenant client. */
async function loadProjectMemberRows(
	tx: TenantTx,
	organizationId: string,
	projectId: string,
): Promise<Array<{ userId: string; role: string }>> {
	return tx
		.select({ userId: projectMember.userId, role: projectMember.role })
		.from(projectMember)
		.where(
			and(
				eq(projectMember.organizationId, organizationId),
				eq(projectMember.projectId, projectId),
			),
		);
}

/**
 * Open the project room, creating it and reconciling its participants.
 *
 * The caller is inserted first because the conversation select policy requires
 * a participant row to read the room back. Everyone else is reconciled after
 * that.
 */
export async function openProjectConversation(
	tenant: TenantContext,
	projectId: string,
): Promise<ProjectConversationResult> {
	// Better Auth owner rows are resolved on the privileged client before the
	// tenant transaction opens.
	const owners = await listOrganizationOwners(tenant.organizationId);
	const ownerIds = owners.map((owner) => owner.userId);

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			const memberRows = await loadProjectMemberRows(
				tx,
				tenant.organizationId,
				projectId,
			);
			const entries = buildParticipantEntries(
				tenant,
				access.role,
				memberRows,
				ownerIds,
			);
			const viewerEntry =
				entries.find((entry) => entry.userId === tenant.userId) ??
				({ userId: tenant.userId, role: "member" } as const);

			const conversationId = projectConversationId(projectId);

			await tx
				.insert(conversation)
				.values({
					id: conversationId,
					organizationId: tenant.organizationId,
					scope: "project",
					projectId,
					createdBy: tenant.userId,
					// A project archived before its first message opens read only.
					archivedAt: access.row.archivedAt,
					memberCount: 0,
				})
				.onConflictDoNothing();

			// The caller's own row is written first, so the select policy can
			// read the room back. This also reactivates a person who was removed
			// from the project and added again.
			await upsertProjectParticipant(
				tx,
				tenant.organizationId,
				conversationId,
				viewerEntry,
			);

			// Keep the archive mirror correct even if a lifecycle write was
			// missed. The caller is active now, so the update policy passes.
			await tx
				.update(conversation)
				.set({ archivedAt: access.row.archivedAt })
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						eq(conversation.id, conversationId),
					),
				);

			const [record] = await tx
				.select()
				.from(conversation)
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						eq(conversation.id, conversationId),
					),
				)
				.limit(1);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That project conversation could not be opened.",
				});
			}

			await syncProjectParticipants(
				tx,
				tenant.organizationId,
				conversationId,
				entries,
			);

			const count = await countActiveParticipants(
				tx,
				tenant.organizationId,
				conversationId,
			);
			await writeMemberCount(
				tx,
				tenant.organizationId,
				conversationId,
				tenant.userId,
				count,
			);

			const participants = await tx
				.select()
				.from(conversationParticipant)
				.where(
					and(
						eq(conversationParticipant.organizationId, tenant.organizationId),
						eq(conversationParticipant.conversationId, conversationId),
						isNull(conversationParticipant.leftAt),
					),
				);

			const people = await loadPeople(
				tenant.organizationId,
				participants.map((participant) => participant.userId),
			);
			const unread = await countConversationUnread(tx, tenant, conversationId);

			return {
				conversation: buildConversationSummary({
					// The count was written after `record` was read, so fold it in
					// instead of returning the pre-sync zero.
					record: { ...record, memberCount: count },
					participants,
					people,
					viewerId: tenant.userId,
					unread,
				}),
				participantIds: participants.map((participant) => participant.userId),
			};
		},
	);
}

/**
 * Read the caller's unread count for one project room.
 *
 * Never creates the room. A project that has never opened messages costs one
 * room lookup and answers zero.
 */
export async function getProjectConversationUnread(
	tenant: TenantContext,
	projectId: string,
): Promise<ProjectConversationUnread> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await loadProjectAccess(tx, tenant, projectId);

			if (!access) {
				throw new APIError("NOT_FOUND", {
					message: "That project no longer exists.",
				});
			}

			const room = await findProjectRoom(tx, tenant.organizationId, projectId);

			if (!room) {
				return { conversationId: null, unread: 0 };
			}

			const [mine] = await tx
				.select({ id: conversationParticipant.id })
				.from(conversationParticipant)
				.where(
					and(
						eq(conversationParticipant.organizationId, tenant.organizationId),
						eq(conversationParticipant.conversationId, room.id),
						eq(conversationParticipant.userId, tenant.userId),
						isNull(conversationParticipant.leftAt),
					),
				)
				.limit(1);

			if (!mine) {
				return { conversationId: room.id, unread: 0 };
			}

			const unread = await countConversationUnread(tx, tenant, room.id);

			return { conversationId: room.id, unread };
		},
	);
}
