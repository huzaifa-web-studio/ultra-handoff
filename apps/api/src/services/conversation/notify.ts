/**
 * Conversation notifications.
 *
 * Why a dedicated writer: the generic notification service inserts and ignores
 * a duplicate, which is right for a comment mention but wrong for a chat. A
 * conversation should own one bell row that is refreshed by each new message,
 * so a busy chat cannot flood the bell. A channel uses a second prefix so its
 * row is cleared independently of a direct chat with the same id, which cannot
 * happen today but keeps the two namespaces honest.
 *
 * How the cross-user write works: the notification INSERT policy is workspace
 * wide, but the UPDATE policy is recipient only. The transaction is therefore
 * scoped to the recipient for the upsert and restored to the actor afterwards,
 * exactly like the comment writer does for its batch insert. Without that, the
 * conflict update would see no row and silently do nothing.
 *
 * Used by: `services/conversation/create.ts` and `read.ts`.
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import { notification } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { NotificationType } from "../../lib/notification-types";
import { renderNotification } from "../../lib/notifications";
import type { TenantContext } from "../../middleware/tenant";
import type { NotificationDelivery } from "../notification.service";

/** Dedupe key prefix for a direct conversation. */
export const DIRECT_MESSAGE_DEDUPE_PREFIX = "dm:";

/** Dedupe key prefix for a group channel. */
export const CHANNEL_MESSAGE_DEDUPE_PREFIX = "channel:";

/** Longest preview kept on the notification row. */
const PREVIEW_MAX = 160;

/** One conversation notification write. */
type ConversationNotificationInput = {
	conversationId: string;
	recipientUserId: string;
	preview: string;
	/** The thread root when the message being notified is a reply. */
	threadRootId?: string | null;
	/** Channel name, used by the rendered copy. Null for a direct chat. */
	channelTitle?: string | null;
};

/**
 * Create or refresh the recipient's bell row for one conversation.
 *
 * Returns the delivery descriptor so the route can publish realtime and queue a
 * push after the transaction commits. Returns null when the row could not be
 * read back, which only happens if the recipient left the workspace between the
 * membership check and the write.
 */
async function upsertConversationNotification(
	tx: TenantTx,
	tenant: TenantContext,
	input: ConversationNotificationInput,
	type: NotificationType,
	dedupePrefix: string,
): Promise<NotificationDelivery | null> {
	const dedupeKey = `${dedupePrefix}${input.conversationId}`;
	const data = {
		preview: input.preview.slice(0, PREVIEW_MAX),
		// Null on a root message, so a newer timeline message replaces a thread
		// deep link instead of leaving a stale one behind.
		threadRootId: input.threadRootId ?? null,
	};

	const [scopeRow] = await tx.execute<{ usr: string | null }>(
		sql`select current_setting('app.current_user_id', true) as usr`,
	);
	const originalUser = scopeRow?.usr ?? "";
	let row: typeof notification.$inferSelect | undefined;

	try {
		await tx.execute(
			sql`select set_config('app.current_user_id', ${input.recipientUserId}, true)`,
		);

		const rows = await tx
			.insert(notification)
			.values({
				id: randomUUID(),
				organizationId: tenant.organizationId,
				recipientUserId: input.recipientUserId,
				actorUserId: tenant.userId,
				type,
				dedupeKey,
				conversationId: input.conversationId,
				data,
			})
			.onConflictDoUpdate({
				target: [notification.recipientUserId, notification.dedupeKey],
				set: {
					actorUserId: tenant.userId,
					conversationId: input.conversationId,
					data,
					// New activity makes the row unread again.
					readAt: null,
					// Bump the sort key so an active conversation rises to the top of
					// the bell instead of sinking under its first message.
					createdAt: new Date(),
					updatedAt: new Date(),
				},
			})
			.returning();

		row = rows[0];
	} finally {
		// The rest of the business transaction must continue as the actor. A
		// failed restore must not mask the original error.
		if (originalUser) {
			await tx
				.execute(
					sql`select set_config('app.current_user_id', ${originalUser}, true)`,
				)
				.catch(() => undefined);
		}
	}

	if (!row) return null;

	const rendered = renderNotification({
		type,
		actorName: tenant.name,
		organizationSlug: tenant.slug,
		organizationName: null,
		project: null,
		milestone: null,
		comment: null,
		changeRequest: null,
		scopeEntry: null,
		conversation: {
			id: input.conversationId,
			title: input.channelTitle ?? null,
		},
		data,
	});

	return {
		notificationId: row.id,
		organizationId: row.organizationId,
		organizationSlug: tenant.slug,
		recipientUserId: row.recipientUserId,
		type,
		title: rendered.title,
		body: rendered.body,
		href: rendered.href,
		createdAt: row.createdAt.toISOString(),
	};
}

/** Create or refresh the bell row for a direct conversation. */
export function upsertDirectMessageNotification(
	tx: TenantTx,
	tenant: TenantContext,
	input: ConversationNotificationInput,
): Promise<NotificationDelivery | null> {
	return upsertConversationNotification(
		tx,
		tenant,
		input,
		"direct_message",
		DIRECT_MESSAGE_DEDUPE_PREFIX,
	);
}

/** Create or refresh the bell row for a group channel. */
export function upsertChannelMessageNotification(
	tx: TenantTx,
	tenant: TenantContext,
	input: ConversationNotificationInput,
): Promise<NotificationDelivery | null> {
	return upsertConversationNotification(
		tx,
		tenant,
		input,
		"group_message",
		CHANNEL_MESSAGE_DEDUPE_PREFIX,
	);
}

/**
 * Clear the bell row for one conversation.
 *
 * Runs as the recipient, so the self-scoped notification update policy applies
 * without any scope switch. A conversation that is not fully read yet keeps its
 * row, which is why the caller decides whether to clear it.
 */
async function markNotificationRead(
	tx: TenantTx,
	tenant: TenantContext,
	dedupeKey: string,
): Promise<void> {
	await tx
		.update(notification)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notification.organizationId, tenant.organizationId),
				eq(notification.recipientUserId, tenant.userId),
				eq(notification.dedupeKey, dedupeKey),
				isNull(notification.readAt),
			),
		);
}

/** Clear the bell row for a direct conversation. */
export async function markDirectMessageNotificationRead(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
): Promise<void> {
	await markNotificationRead(
		tx,
		tenant,
		`${DIRECT_MESSAGE_DEDUPE_PREFIX}${conversationId}`,
	);
}

/** Clear the bell row for a channel. */
export async function markChannelMessageNotificationRead(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
): Promise<void> {
	await markNotificationRead(
		tx,
		tenant,
		`${CHANNEL_MESSAGE_DEDUPE_PREFIX}${conversationId}`,
	);
}
