/**
 * Sending a message.
 *
 * Why this file: a send writes three rows in one transaction (the message, the
 * conversation activity and the sender's read cursor) and refreshes the
 * recipient's bell. Keeping them together is what makes the sidebar preview,
 * the unread badge and the bell agree with the message that caused them.
 *
 * Idempotency: the browser generates `clientNonce` before the request. A retry
 * after a timeout hits the unique index and returns the original row, so a
 * flaky connection cannot post the same message twice.
 *
 * Used by: `routes/conversations.ts`.
 */

import { randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";

import {
	conversation,
	conversationMessage,
	conversationParticipant,
} from "../../db/schema";
import { withTenant } from "../../db/tenant";
import { notificationPreview } from "../../lib/notifications";
import { sanitizeCommentBody } from "../../lib/rich-text";
import type { TenantContext } from "../../middleware/tenant";
import type { NotificationDelivery } from "../notification.service";
import {
	allowMessageRate,
	assertRecipientMember,
	loadMessageByNonce,
	loadPeople,
	requireConversation,
	toMessageRow,
} from "./access";
import { upsertDirectMessageNotification } from "./notify";
import type {
	ConversationMessageResult,
	CreateConversationMessageInput,
} from "./types";

/** The result a send returns, plus the transport metadata the route strips. */
export type CreateMessageResult = ConversationMessageResult & {
	/** The other participant, so the route can publish to both sides. */
	recipientUserId: string;
	notifications: NotificationDelivery[];
};

/**
 * Post one message.
 *
 * The throttle runs before the transaction so a rejected request never holds
 * one open. It fails open, like every other throttle in the app.
 */
export async function createConversationMessage(
	tenant: TenantContext,
	conversationId: string,
	input: CreateConversationMessageInput,
): Promise<CreateMessageResult> {
	const body = sanitizeCommentBody(input.body);
	const clientNonce = input.clientNonce.trim();

	if (clientNonce.length === 0 || clientNonce.length > 64) {
		throw new APIError("BAD_REQUEST", {
			message: "That message could not be identified. Try sending it again.",
		});
	}

	const allowed = await allowMessageRate(tenant);

	if (!allowed) {
		throw new APIError("TOO_MANY_REQUESTS", {
			message:
				"You are sending messages too quickly. Wait a minute and try again.",
		});
	}

	const preview = notificationPreview(body.text) ?? "";

	return withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			const access = await requireConversation(tx, tenant, conversationId);
			const recipient = access.counterpart;

			if (!recipient) {
				throw new APIError("BAD_REQUEST", {
					message: "This conversation has no one to send to.",
				});
			}

			// A person removed from the workspace keeps their history but cannot
			// receive a new message.
			await assertRecipientMember(tenant.organizationId, recipient.userId);

			const inserted = await tx
				.insert(conversationMessage)
				.values({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					conversationId,
					authorId: tenant.userId,
					body: body.value,
					bodyText: body.text,
					clientNonce,
				})
				.onConflictDoNothing()
				.returning();

			// A retry with the same nonce returns the original row. It is a success
			// from the writer's point of view, not an error.
			const record =
				inserted[0] ??
				(await loadMessageByNonce(
					tx,
					tenant,
					conversationId,
					tenant.userId,
					clientNonce,
				));

			if (!record) {
				throw new APIError("NOT_FOUND", {
					message: "That message could not be read back.",
				});
			}

			const created = inserted.length > 0;

			if (created) {
				await tx
					.update(conversation)
					.set({
						lastMessageAt: record.createdAt,
						lastMessageId: record.id,
						lastMessageAuthorId: tenant.userId,
						lastMessagePreview: preview,
					})
					.where(
						and(
							eq(conversation.organizationId, tenant.organizationId),
							eq(conversation.id, conversationId),
						),
					);

				// Sending is reading. The sender's own message can never be unread
				// to them, and this keeps the sidebar honest across devices.
				await tx
					.update(conversationParticipant)
					.set({
						lastReadAt: record.createdAt,
						lastReadMessageId: record.id,
					})
					.where(
						and(
							eq(conversationParticipant.organizationId, tenant.organizationId),
							eq(conversationParticipant.conversationId, conversationId),
							eq(conversationParticipant.userId, tenant.userId),
						),
					);
			}

			const people = await loadPeople(tenant.organizationId, [tenant.userId]);
			const message = toMessageRow(record, people, tenant.userId);

			const notification = created
				? await upsertDirectMessageNotification(tx, tenant, {
						conversationId,
						recipientUserId: recipient.userId,
						preview,
					})
				: null;

			return {
				message,
				created,
				recipientUserId: recipient.userId,
				conversation: {
					id: conversationId,
					lastMessageAt: record.createdAt.toISOString(),
					lastMessageId: record.id,
					lastMessageAuthorId: tenant.userId,
					lastMessagePreview: preview,
				},
				notifications: notification ? [notification] : [],
			};
		},
	);
}
