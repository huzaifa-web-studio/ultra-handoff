/**
 * Editing and deleting a message.
 *
 * Why this file: both actions rewrite the conversation preview when the row is
 * the newest message, and both are author only. Keeping them together means
 * that rule is stated once.
 *
 * A delete is soft: the row stays so the conversation keeps its shape, the body
 * is blanked, and the preview says the message was deleted. The record of who
 * said what stays honest.
 *
 * Used by: `routes/conversations.ts`.
 */

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import { conversation, conversationMessage } from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { notificationPreview } from "../../lib/notifications";
import { sanitizeCommentBody } from "../../lib/rich-text";
import type { TenantContext } from "../../middleware/tenant";
import {
	loadMessageRecord,
	loadPeople,
	requireConversation,
	toMessageRow,
} from "./access";
import type { ConversationMessageRow } from "./types";

/** What the list shows when the newest message was deleted. */
const DELETED_PREVIEW = "Message deleted";

/** Reject a change by anyone but the author. */
function assertAuthor(record: { authorId: string | null }, viewerId: string) {
	if (record.authorId !== viewerId) {
		throw new APIError("FORBIDDEN", {
			message: "Only the person who wrote a message can change it.",
		});
	}
}

/** The write result an edit or a delete returns. */
export type ConversationMessageMutationResult = {
	message: ConversationMessageRow;
	/** Every participant, so the route can publish to each side. */
	participantIds: string[];
};

/** Change the body of your own message. */
export async function editConversationMessage(
	tenant: TenantContext,
	conversationId: string,
	messageId: string,
	input: { body: unknown },
): Promise<ConversationMessageMutationResult> {
	const body = sanitizeCommentBody(
		input.body,
		"Write something before sending your message.",
	);

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);
			const record = await loadMessageRecord(
				tx,
				tenant,
				conversationId,
				messageId,
			);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That message no longer exists.",
				});
			}

			assertAuthor(record, tenant.userId);

			if (record.deletedAt !== null) {
				throw new APIError("BAD_REQUEST", {
					message: "That message was deleted and can no longer be changed.",
				});
			}

			const [updated] = await tx
				.update(conversationMessage)
				.set({
					body: body.value,
					bodyText: body.text,
					editedAt: new Date(),
				})
				.where(
					and(
						eq(conversationMessage.organizationId, tenant.organizationId),
						eq(conversationMessage.conversationId, conversationId),
						eq(conversationMessage.id, messageId),
					),
				)
				.returning();

			if (!updated) {
				throw new APIError("NOT_FOUND", {
					message: "That message no longer exists.",
				});
			}

			// Only the newest message feeds the sidebar preview.
			if (access.conversation.lastMessageId === messageId) {
				await tx
					.update(conversation)
					.set({
						lastMessagePreview: notificationPreview(body.text) ?? "",
					})
					.where(
						and(
							eq(conversation.organizationId, tenant.organizationId),
							eq(conversation.id, conversationId),
						),
					);
			}

			const people = await loadPeople(tenant.organizationId, [tenant.userId]);

			return {
				message: toMessageRow(updated, people, tenant.userId),
				participantIds: access.participants.map(
					(participant) => participant.userId,
				),
			};
		},
	);
}

/** Soft delete your own message. */
export async function deleteConversationMessage(
	tenant: TenantContext,
	conversationId: string,
	messageId: string,
): Promise<ConversationMessageMutationResult> {
	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);
			const record = await loadMessageRecord(
				tx,
				tenant,
				conversationId,
				messageId,
			);

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That message no longer exists.",
				});
			}

			assertAuthor(record, tenant.userId);

			if (record.deletedAt !== null) {
				const people = await loadPeople(tenant.organizationId, [tenant.userId]);

				return {
					message: toMessageRow(record, people, tenant.userId),
					participantIds: access.participants.map(
						(participant) => participant.userId,
					),
				};
			}

			const [updated] = await tx
				.update(conversationMessage)
				.set({
					body: [],
					bodyText: "",
					deletedAt: new Date(),
				})
				.where(
					and(
						eq(conversationMessage.organizationId, tenant.organizationId),
						eq(conversationMessage.conversationId, conversationId),
						eq(conversationMessage.id, messageId),
					),
				)
				.returning();

			if (!updated) {
				throw new APIError("NOT_FOUND", {
					message: "That message no longer exists.",
				});
			}

			if (access.conversation.lastMessageId === messageId) {
				await tx
					.update(conversation)
					.set({ lastMessagePreview: DELETED_PREVIEW })
					.where(
						and(
							eq(conversation.organizationId, tenant.organizationId),
							eq(conversation.id, conversationId),
						),
					);
			}

			const people = await loadPeople(tenant.organizationId, [tenant.userId]);

			return {
				message: toMessageRow(updated, people, tenant.userId),
				participantIds: access.participants.map(
					(participant) => participant.userId,
				),
			};
		},
	);
}
