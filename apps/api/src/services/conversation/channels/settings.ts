/**
 * Channel settings.
 *
 * Rename, topic, visibility and archive. Every action is owner only, and an
 * archived channel is read only until it is restored. A channel is never hard
 * deleted, so the message history stays intact.
 *
 * Used by: `routes/channels/`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { conversation } from "../../../db/schema";
import { withTenant } from "../../../db/tenant";
import type { TenantContext } from "../../../middleware/tenant";
import { requireGroupOwner } from "../access";
import type { UpdateChannelInput } from "../types";
import type { ChannelResult } from "./create";
import { assertTitleAvailable, loadChannelSummary } from "./shared";
import {
	isUniqueViolation,
	normalizeChannelDescription,
	normalizeChannelTitle,
	normalizeVisibility,
} from "./validate";

/** The settings fields that actually changed. */
export type UpdateChannelResult = ChannelResult & {
	changed: ("title" | "description" | "visibility")[];
};

/** Change the name, topic or visibility of a channel. */
export async function updateChannel(
	tenant: TenantContext,
	conversationId: string,
	input: UpdateChannelInput,
): Promise<UpdateChannelResult> {
	const title =
		input.title === undefined ? undefined : normalizeChannelTitle(input.title);
	const description =
		input.description === undefined
			? undefined
			: normalizeChannelDescription(input.description);
	const visibility =
		input.visibility === undefined
			? undefined
			: normalizeVisibility(input.visibility);

	if (
		title === undefined &&
		description === undefined &&
		visibility === undefined
	) {
		throw new APIError("BAD_REQUEST", {
			message: "There is nothing to change.",
		});
	}

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireGroupOwner(tx, tenant, conversationId);

			if (access.conversation.archivedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "Restore the channel before changing its settings.",
				});
			}

			const changed: UpdateChannelResult["changed"] = [];

			if (title !== undefined && title !== access.conversation.title) {
				await assertTitleAvailable(
					tx,
					tenant.organizationId,
					title,
					conversationId,
				);
				changed.push("title");
			}

			if (
				description !== undefined &&
				description !== access.conversation.description
			) {
				changed.push("description");
			}

			if (
				visibility !== undefined &&
				visibility !== access.conversation.visibility
			) {
				changed.push("visibility");
			}

			if (changed.length > 0) {
				try {
					await tx
						.update(conversation)
						.set({
							...(title !== undefined ? { title } : {}),
							...(description !== undefined ? { description } : {}),
							...(visibility !== undefined ? { visibility } : {}),
						})
						.where(
							and(
								eq(conversation.organizationId, tenant.organizationId),
								eq(conversation.id, conversationId),
							),
						);
				} catch (error) {
					if (isUniqueViolation(error, "conversation_org_group_title_idx")) {
						throw new APIError("BAD_REQUEST", {
							message: "A channel with that name already exists.",
						});
					}

					throw error;
				}
			}

			const result = await loadChannelSummary(tx, tenant, conversationId);

			return {
				conversation: result.summary,
				participantIds: result.participantIds,
				changed,
			};
		},
	);
}

/**
 * Archive or restore a channel.
 *
 * Archiving hides it from the sidebar and blocks new messages. Restoring brings
 * it back with the same members and history.
 */
export async function setChannelArchived(
	tenant: TenantContext,
	conversationId: string,
	archived: boolean,
): Promise<ChannelResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await requireGroupOwner(tx, tenant, conversationId);

			await tx
				.update(conversation)
				.set({ archivedAt: archived ? new Date() : null })
				.where(
					and(
						eq(conversation.organizationId, tenant.organizationId),
						eq(conversation.id, conversationId),
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
