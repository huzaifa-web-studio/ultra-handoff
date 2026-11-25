/**
 * Direct message notifications.
 *
 * Why a dedicated writer: the generic notification service inserts and ignores
 * a duplicate, which is right for a comment mention but wrong for a chat. A
 * conversation should own one bell row that is refreshed by each new message,
 * so a busy chat cannot flood the bell.
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
import { renderNotification } from "../../lib/notifications";
import type { TenantContext } from "../../middleware/tenant";
import type { NotificationDelivery } from "../notification.service";

/** Dedupe key prefix. One row per conversation per recipient. */
export const DIRECT_MESSAGE_DEDUPE_PREFIX = "dm:";

/** Longest preview kept on the notification row. */
const PREVIEW_MAX = 160;

/**
 * Create or refresh the recipient's bell row for one conversation.
 *
 * Returns the delivery descriptor so the route can publish realtime and queue a
 * push after the transaction commits. Returns null when the row could not be
 * read back, which only happens if the recipient left the workspace between the
 * membership check and the write.
 */
export async function upsertDirectMessageNotification(
	tx: TenantTx,
	tenant: TenantContext,
	input: {
		conversationId: string;
		recipientUserId: string;
		preview: string;
	},
): Promise<NotificationDelivery | null> {
	const dedupeKey = `${DIRECT_MESSAGE_DEDUPE_PREFIX}${input.conversationId}`;
	const data = { preview: input.preview.slice(0, PREVIEW_MAX) };

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
				type: "direct_message",
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
		type: "direct_message",
		actorName: tenant.name,
		organizationSlug: tenant.slug,
		organizationName: null,
		project: null,
		milestone: null,
		comment: null,
		changeRequest: null,
		scopeEntry: null,
		conversation: { id: input.conversationId },
		data,
	});

	return {
		notificationId: row.id,
		organizationId: row.organizationId,
		organizationSlug: tenant.slug,
		recipientUserId: row.recipientUserId,
		type: "direct_message",
		title: rendered.title,
		body: rendered.body,
		href: rendered.href,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * Clear the bell row for one conversation.
 *
 * Runs as the recipient, so the self-scoped notification update policy applies
 * without any scope switch. A conversation that is not fully read yet keeps its
 * row, which is why the caller decides whether to clear it.
 */
export async function markDirectMessageNotificationRead(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
): Promise<void> {
	await tx
		.update(notification)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(notification.organizationId, tenant.organizationId),
				eq(notification.recipientUserId, tenant.userId),
				eq(
					notification.dedupeKey,
					`${DIRECT_MESSAGE_DEDUPE_PREFIX}${conversationId}`,
				),
				isNull(notification.readAt),
			),
		);
}
