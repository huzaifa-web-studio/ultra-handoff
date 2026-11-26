/**
 * Channel membership actions.
 *
 * Join, leave, add, remove, promote and mute. Every rule that the database
 * cannot express is here: a public channel is self joinable, a private one is
 * owner managed, the last owner cannot leave, and a removed member keeps their
 * row so a rejoin restores the same history and read cursor.
 *
 * Used by: `routes/channels/`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, eq, inArray } from "drizzle-orm";

import { conversation, conversationParticipant } from "../../../db/schema";
import { withTenant } from "../../../db/tenant";
import type { TenantContext } from "../../../middleware/tenant";
import { requireConversation, requireGroupOwner } from "../access";
import { CHANNEL_MEMBER_MAX } from "../types";
import type { ChannelResult } from "./create";
import {
	countActiveOwners,
	loadChannelSummary,
	refreshMemberCount,
	withTargetUser,
} from "./shared";
import { assertWorkspaceMembers, normalizeMemberIds } from "./validate";

/** The result of leaving a channel. */
export type LeaveChannelResult = {
	conversationId: string;
	/** Everyone still active, so the route can tell them the roster changed. */
	participantIds: string[];
};

/**
 * Join a public channel, or restore a previous membership.
 *
 * The cursor is kept on a rejoin, so the person sees what they missed instead
 * of silently skipping it. A private channel can only be joined by being added,
 * and the select policy already hides it from a non-member.
 */
export async function joinChannel(
	tenant: TenantContext,
	conversationId: string,
): Promise<ChannelResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
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

			if (!record || record.scope !== "group") {
				throw new APIError("NOT_FOUND", {
					message: "That channel no longer exists.",
				});
			}

			if (record.visibility !== "public") {
				throw new APIError("NOT_FOUND", {
					message: "That channel no longer exists.",
				});
			}

			if (record.archivedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "That channel is archived and cannot be joined.",
				});
			}

			const [mine] = await tx
				.select()
				.from(conversationParticipant)
				.where(
					and(
						eq(conversationParticipant.organizationId, tenant.organizationId),
						eq(conversationParticipant.conversationId, conversationId),
						eq(conversationParticipant.userId, tenant.userId),
					),
				)
				.limit(1);

			if (!mine) {
				if (record.memberCount >= CHANNEL_MEMBER_MAX) {
					throw new APIError("BAD_REQUEST", {
						message: "This channel is full.",
					});
				}

				await tx.insert(conversationParticipant).values({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					conversationId,
					userId: tenant.userId,
					role: "member",
				});
			} else if (mine.leftAt !== null) {
				if (record.memberCount >= CHANNEL_MEMBER_MAX) {
					throw new APIError("BAD_REQUEST", {
						message: "This channel is full.",
					});
				}

				await tx
					.update(conversationParticipant)
					.set({ leftAt: null })
					.where(eq(conversationParticipant.id, mine.id));
			}

			await refreshMemberCount(tx, tenant.organizationId, conversationId);

			const result = await loadChannelSummary(tx, tenant, conversationId);

			return {
				conversation: result.summary,
				participantIds: result.participantIds,
			};
		},
	);
}

/**
 * Leave a channel.
 *
 * The last owner cannot leave, because an ownerless channel can never be
 * managed again. Archiving or promoting another owner is the way out. The
 * member count is recomputed before `left_at` is set, because the conversation
 * update policy requires the actor to still be a participant.
 */
export async function leaveChannel(
	tenant: TenantContext,
	conversationId: string,
): Promise<LeaveChannelResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);

			if (access.conversation.scope !== "group") {
				throw new APIError("BAD_REQUEST", {
					message: "Direct conversations cannot be left.",
				});
			}

			if (access.viewer.role === "owner") {
				const otherOwners = await countActiveOwners(
					tx,
					tenant.organizationId,
					conversationId,
					tenant.userId,
				);

				if (otherOwners === 0) {
					throw new APIError("BAD_REQUEST", {
						message:
							"You are the last owner. Promote another owner or archive the channel first.",
					});
				}
			}

			const remaining = access.participants
				.filter((participant) => participant.userId !== tenant.userId)
				.map((participant) => participant.userId);

			await refreshMemberCount(
				tx,
				tenant.organizationId,
				conversationId,
				tenant.userId,
			);

			await tx
				.update(conversationParticipant)
				.set({ leftAt: new Date() })
				.where(
					and(
						eq(conversationParticipant.organizationId, tenant.organizationId),
						eq(conversationParticipant.conversationId, conversationId),
						eq(conversationParticipant.userId, tenant.userId),
					),
				);

			return { conversationId, participantIds: remaining };
		},
	);
}

/**
 * Add people to a channel. Owner only.
 *
 * A person who left and is added again keeps their old cursor, the same rule as
 * a rejoin. The member cap counts active rows plus the new people.
 */
export async function addChannelMembers(
	tenant: TenantContext,
	conversationId: string,
	values: string[],
): Promise<ChannelResult> {
	const memberIds = normalizeMemberIds(values, tenant.userId);

	if (memberIds.length === 0) {
		throw new APIError("BAD_REQUEST", {
			message: "Choose someone to add to the channel.",
		});
	}

	await assertWorkspaceMembers(tenant.organizationId, memberIds);

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireGroupOwner(tx, tenant, conversationId);

			if (access.conversation.archivedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "Restore the channel before adding members.",
				});
			}

			const active = new Set(
				access.participants.map((participant) => participant.userId),
			);
			const toAdd = memberIds.filter((userId) => !active.has(userId));

			if (active.size + toAdd.length > CHANNEL_MEMBER_MAX) {
				throw new APIError("BAD_REQUEST", {
					message: `A channel can have at most ${CHANNEL_MEMBER_MAX} members.`,
				});
			}

			if (toAdd.length > 0) {
				const existing = await tx
					.select()
					.from(conversationParticipant)
					.where(
						and(
							eq(conversationParticipant.organizationId, tenant.organizationId),
							eq(conversationParticipant.conversationId, conversationId),
							inArray(conversationParticipant.userId, toAdd),
						),
					);

				const byUser = new Map(
					existing.map((row) => [row.userId, row] as const),
				);
				const rejoining = toAdd.filter((userId) => {
					const row = byUser.get(userId);

					return row ? row.leftAt !== null : false;
				});
				const fresh = toAdd.filter((userId) => !byUser.has(userId));

				if (rejoining.length > 0) {
					for (const userId of rejoining) {
						await withTargetUser(tx, userId, () =>
							tx
								.update(conversationParticipant)
								.set({ leftAt: null })
								.where(
									and(
										eq(
											conversationParticipant.organizationId,
											tenant.organizationId,
										),
										eq(conversationParticipant.conversationId, conversationId),
										eq(conversationParticipant.userId, userId),
									),
								),
						);
					}
				}

				if (fresh.length > 0) {
					await tx.insert(conversationParticipant).values(
						fresh.map((userId) => ({
							id: randomUUID(),
							organizationId: tenant.organizationId,
							conversationId,
							userId,
							role: "member",
						})),
					);
				}

				await refreshMemberCount(tx, tenant.organizationId, conversationId);
			}

			const result = await loadChannelSummary(tx, tenant, conversationId);

			return {
				conversation: result.summary,
				participantIds: result.participantIds,
			};
		},
	);
}

/** The result of removing one member. */
export type RemoveChannelMemberResult = ChannelResult & {
	removedUserId: string;
};

/** Remove one member. Owner only, never yourself, never the last owner. */
export async function removeChannelMember(
	tenant: TenantContext,
	conversationId: string,
	targetUserId: string,
): Promise<RemoveChannelMemberResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireGroupOwner(tx, tenant, conversationId);

			if (access.conversation.archivedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "Restore the channel before removing members.",
				});
			}

			if (targetUserId === tenant.userId) {
				throw new APIError("BAD_REQUEST", {
					message: "Use leave to remove yourself from a channel.",
				});
			}

			const target = access.participants.find(
				(participant) => participant.userId === targetUserId,
			);

			if (!target) {
				throw new APIError("NOT_FOUND", {
					message: "That person is not in this channel.",
				});
			}

			if (target.role === "owner") {
				const otherOwners = await countActiveOwners(
					tx,
					tenant.organizationId,
					conversationId,
					targetUserId,
				);

				if (otherOwners === 0) {
					throw new APIError("BAD_REQUEST", {
						message:
							"The last owner cannot be removed. Promote another owner first.",
					});
				}
			}

			await withTargetUser(tx, targetUserId, () =>
				tx
					.update(conversationParticipant)
					.set({ leftAt: new Date() })
					.where(
						and(
							eq(conversationParticipant.organizationId, tenant.organizationId),
							eq(conversationParticipant.conversationId, conversationId),
							eq(conversationParticipant.userId, targetUserId),
						),
					),
			);

			await refreshMemberCount(tx, tenant.organizationId, conversationId);

			const result = await loadChannelSummary(tx, tenant, conversationId);

			return {
				conversation: result.summary,
				participantIds: result.participantIds,
				removedUserId: targetUserId,
			};
		},
	);
}

/** Promote or demote one member. Owner only, last owner protected. */
export async function setChannelMemberRole(
	tenant: TenantContext,
	conversationId: string,
	targetUserId: string,
	role: "owner" | "member",
): Promise<ChannelResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireGroupOwner(tx, tenant, conversationId);

			if (access.conversation.archivedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "Restore the channel before changing roles.",
				});
			}

			const target = access.participants.find(
				(participant) => participant.userId === targetUserId,
			);

			if (!target) {
				throw new APIError("NOT_FOUND", {
					message: "That person is not in this channel.",
				});
			}

			if (target.role === role) {
				const unchanged = await loadChannelSummary(tx, tenant, conversationId);

				return {
					conversation: unchanged.summary,
					participantIds: unchanged.participantIds,
				};
			}

			if (target.role === "owner" && role === "member") {
				const otherOwners = await countActiveOwners(
					tx,
					tenant.organizationId,
					conversationId,
					targetUserId,
				);

				if (otherOwners === 0) {
					throw new APIError("BAD_REQUEST", {
						message: "A channel needs at least one owner.",
					});
				}
			}

			await withTargetUser(tx, targetUserId, () =>
				tx
					.update(conversationParticipant)
					.set({ role })
					.where(
						and(
							eq(conversationParticipant.organizationId, tenant.organizationId),
							eq(conversationParticipant.conversationId, conversationId),
							eq(conversationParticipant.userId, targetUserId),
						),
					),
			);

			const result = await loadChannelSummary(tx, tenant, conversationId);

			return {
				conversation: result.summary,
				participantIds: result.participantIds,
			};
		},
	);
}

/** Mute or unmute a channel for the viewer. */
export async function setChannelMuted(
	tenant: TenantContext,
	conversationId: string,
	muted: boolean,
): Promise<ChannelResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);

			if (access.conversation.scope !== "group") {
				throw new APIError("BAD_REQUEST", {
					message: "Only channels can be muted.",
				});
			}

			await tx
				.update(conversationParticipant)
				.set({ mutedAt: muted ? new Date() : null })
				.where(
					and(
						eq(conversationParticipant.organizationId, tenant.organizationId),
						eq(conversationParticipant.conversationId, conversationId),
						eq(conversationParticipant.userId, tenant.userId),
					),
				);

			const result = await loadChannelSummary(tx, tenant, conversationId);

			return {
				conversation: result.summary,
				participantIds: result.participantIds,
			};
		},
	);
}
