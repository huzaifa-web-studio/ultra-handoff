/**
 * Channel maintenance when a person leaves a workspace.
 *
 * Why this lives under `auth/`: removing or leaving an organization is owned by
 * Better Auth, and the only reliable observation points are its organization
 * hooks. The maintenance needs the privileged client because the person's
 * `member` row is already gone when the hook runs, so it cannot resolve a
 * tenant scope.
 *
 * What it does, for group conversations only:
 *   - marks the person's participant rows left, so they lose read and send
 *     access and stop counting toward the member cap;
 *   - recomputes `member_count` from the remaining active rows;
 *   - promotes the earliest remaining member when the departed person was the
 *     last owner, so the channel is never stranded without a manager;
 *   - archives a channel that has no members left;
 *   - tells the remaining members that the roster changed.
 *
 * Direct conversations are intentionally untouched. Their row stays so the
 * other person sees "no longer in this workspace" and the history stays read
 * only, which is the existing direct message rule.
 *
 * Every failure is logged and swallowed. A channel cleanup must never fail the
 * removal request itself.
 *
 * Used by: `auth/auth.ts` organization hooks and account deletion.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { adminDb } from "../db";
import { member } from "../db/auth-schema";
import { conversation, conversationParticipant } from "../db/schema";
import type { ConversationUpdatedPayload } from "../realtime/events";
import { publishConversationToUsers } from "../services/conversation/publish";

/** Count active rows in one conversation, optionally limited to owners. */
async function countActive(
	tx: Parameters<Parameters<typeof adminDb.transaction>[0]>[0],
	organizationId: string,
	conversationId: string,
	ownersOnly = false,
): Promise<number> {
	const conditions = [
		eq(conversationParticipant.organizationId, organizationId),
		eq(conversationParticipant.conversationId, conversationId),
		isNull(conversationParticipant.leftAt),
	];

	if (ownersOnly) {
		conditions.push(eq(conversationParticipant.role, "owner"));
	}

	const [row] = await tx
		.select({ count: sql<number>`count(*)`.mapWith(Number) })
		.from(conversationParticipant)
		.where(and(...conditions));

	return row?.count ?? 0;
}

/**
 * Detach one person from every group channel in one workspace.
 *
 * Safe to call more than once. A second call finds no active rows and returns.
 */
export async function detachWorkspaceMemberFromChannels(
	organizationId: string,
	userId: string,
): Promise<void> {
	try {
		// Project rooms follow project membership, which cascades when the
		// member row is removed. Detach them first, but keep a failure here from
		// skipping the channel cleanup below.
		try {
			await detachWorkspaceMemberFromProjectRooms(organizationId, userId);
		} catch (error) {
			console.error(
				"[member-channels] could not detach a workspace member from project rooms",
				error,
			);
		}

		const affected = await adminDb
			.select({ conversationId: conversationParticipant.conversationId })
			.from(conversationParticipant)
			.innerJoin(
				conversation,
				eq(conversation.id, conversationParticipant.conversationId),
			)
			.where(
				and(
					eq(conversationParticipant.organizationId, organizationId),
					eq(conversationParticipant.userId, userId),
					isNull(conversationParticipant.leftAt),
					eq(conversation.scope, "group"),
				),
			);

		const conversationIds = [
			...new Set(affected.map((row) => row.conversationId)),
		];

		if (conversationIds.length === 0) return;

		const rosters = new Map<string, string[]>();

		await adminDb.transaction(async (tx) => {
			await tx
				.update(conversationParticipant)
				.set({ leftAt: new Date() })
				.where(
					and(
						eq(conversationParticipant.organizationId, organizationId),
						eq(conversationParticipant.userId, userId),
						isNull(conversationParticipant.leftAt),
						inArray(conversationParticipant.conversationId, conversationIds),
					),
				);

			for (const conversationId of conversationIds) {
				const remaining = await countActive(tx, organizationId, conversationId);

				// Keep an owner. The departed person may have been the last one.
				if (remaining > 0) {
					const owners = await countActive(
						tx,
						organizationId,
						conversationId,
						true,
					);

					if (owners === 0) {
						const [nextOwner] = await tx
							.select({ userId: conversationParticipant.userId })
							.from(conversationParticipant)
							.where(
								and(
									eq(conversationParticipant.organizationId, organizationId),
									eq(conversationParticipant.conversationId, conversationId),
									isNull(conversationParticipant.leftAt),
								),
							)
							.orderBy(
								asc(conversationParticipant.createdAt),
								asc(conversationParticipant.userId),
							)
							.limit(1);

						if (nextOwner) {
							await tx
								.update(conversationParticipant)
								.set({ role: "owner" })
								.where(
									and(
										eq(conversationParticipant.organizationId, organizationId),
										eq(conversationParticipant.conversationId, conversationId),
										eq(conversationParticipant.userId, nextOwner.userId),
									),
								);
						}
					}
				} else {
					// Nobody is left. Archive the empty room instead of leaving a
					// channel that no owner can ever reach.
					await tx
						.update(conversation)
						.set({ archivedAt: new Date() })
						.where(
							and(
								eq(conversation.organizationId, organizationId),
								eq(conversation.id, conversationId),
							),
						);
				}

				await tx
					.update(conversation)
					.set({ memberCount: remaining })
					.where(
						and(
							eq(conversation.organizationId, organizationId),
							eq(conversation.id, conversationId),
						),
					);

				const stillThere = await tx
					.select({ userId: conversationParticipant.userId })
					.from(conversationParticipant)
					.where(
						and(
							eq(conversationParticipant.organizationId, organizationId),
							eq(conversationParticipant.conversationId, conversationId),
							isNull(conversationParticipant.leftAt),
						),
					);

				rosters.set(
					conversationId,
					stillThere.map((row) => row.userId),
				);
			}
		});

		// Publish after the commit so a reader cannot refetch the old roster.
		for (const [conversationId, participantIds] of rosters) {
			publishConversationToUsers(
				organizationId,
				participantIds,
				"conversation.updated",
				{ conversationId } satisfies ConversationUpdatedPayload,
			);
		}
	} catch (error) {
		console.error(
			"[member-channels] could not detach a workspace member from channels",
			error,
		);
	}
}

/**
 * Detach one person from every project room in one workspace.
 *
 * Why on the privileged client: the `member` row is already gone when the hook
 * runs, so no tenant scope can be resolved. Project rooms have no owner to
 * promote and no empty room to archive, so this only revokes the row and
 * repairs the denormalised count.
 */
async function detachWorkspaceMemberFromProjectRooms(
	organizationId: string,
	userId: string,
): Promise<void> {
	const affected = await adminDb
		.select({ conversationId: conversationParticipant.conversationId })
		.from(conversationParticipant)
		.innerJoin(
			conversation,
			eq(conversation.id, conversationParticipant.conversationId),
		)
		.where(
			and(
				eq(conversationParticipant.organizationId, organizationId),
				eq(conversationParticipant.userId, userId),
				isNull(conversationParticipant.leftAt),
				eq(conversation.scope, "project"),
			),
		);

	const conversationIds = [
		...new Set(affected.map((row) => row.conversationId)),
	];

	if (conversationIds.length === 0) return;

	await adminDb.transaction(async (tx) => {
		await tx
			.update(conversationParticipant)
			.set({ leftAt: new Date() })
			.where(
				and(
					eq(conversationParticipant.organizationId, organizationId),
					eq(conversationParticipant.userId, userId),
					isNull(conversationParticipant.leftAt),
					inArray(conversationParticipant.conversationId, conversationIds),
				),
			);

		for (const conversationId of conversationIds) {
			const [row] = await tx
				.select({ count: sql<number>`count(*)`.mapWith(Number) })
				.from(conversationParticipant)
				.where(
					and(
						eq(conversationParticipant.organizationId, organizationId),
						eq(conversationParticipant.conversationId, conversationId),
						isNull(conversationParticipant.leftAt),
					),
				);

			await tx
				.update(conversation)
				.set({ memberCount: row?.count ?? 0 })
				.where(
					and(
						eq(conversation.organizationId, organizationId),
						eq(conversation.id, conversationId),
					),
				);
		}
	});
}

/** Detach one person from every workspace they still belong to. */
export async function detachUserFromAllWorkspaces(
	userId: string,
): Promise<void> {
	try {
		const memberships = await adminDb
			.select({ organizationId: member.organizationId })
			.from(member)
			.where(eq(member.userId, userId));

		for (const membership of memberships) {
			await detachWorkspaceMemberFromChannels(
				membership.organizationId,
				userId,
			);
		}
	} catch (error) {
		console.error(
			"[member-channels] could not detach a deleted user from channels",
			error,
		);
	}
}
