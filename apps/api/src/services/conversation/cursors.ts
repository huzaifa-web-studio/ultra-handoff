/**
 * Monotonic read cursors.
 *
 * Why raw SQL: a cursor must store the message's exact `created_at`, including
 * microseconds. Round-tripping the timestamp through a JavaScript `Date`
 * truncates it to milliseconds, which makes the message look newer than its own
 * cursor and keeps it unread forever. Copying the value inside Postgres avoids
 * that completely, for both the conversation cursor and a thread cursor.
 *
 * Both helpers are monotonic: an older message can never move a cursor back.
 * Used by: `services/conversation/create.ts` and `read.ts`.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import type { TenantTx } from "../../db/tenant";
import type { TenantContext } from "../../middleware/tenant";

/** One stored cursor position. */
export type CursorState = {
	lastReadAt: Date;
	lastReadMessageId: string | null;
};

/** A raw cursor row. postgres.js returns a timestamp here as a string. */
type RawCursorRow = {
	last_read_at: Date | string;
	last_read_message_id: string | null;
};

/** Normalise a raw row into a cursor with a real Date. */
function toCursorState(row: RawCursorRow): CursorState {
	return {
		lastReadAt:
			row.last_read_at instanceof Date
				? row.last_read_at
				: new Date(row.last_read_at),
		lastReadMessageId: row.last_read_message_id,
	};
}

/**
 * Move the conversation cursor to one root message.
 *
 * The cursor covers the main timeline only. Replies use a thread cursor, so
 * opening the conversation cannot mark a thread read.
 */
export async function advanceConversationCursor(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
	messageId: string,
): Promise<CursorState> {
	const updated = await tx.execute<RawCursorRow>(sql`
		update conversation_participant as p
		set last_read_at = m.created_at,
			last_read_message_id = m.id,
			updated_at = now()
		from conversation_message as m
		where p.organization_id = ${tenant.organizationId}
			and p.conversation_id = ${conversationId}
			and p.user_id = ${tenant.userId}
			and m.organization_id = ${tenant.organizationId}
			and m.conversation_id = ${conversationId}
			and m.id = ${messageId}
			and m.parent_id is null
			and (
				m.created_at,
				m.id
			) > (
				p.last_read_at,
				coalesce(p.last_read_message_id, '')
			)
		returning
			p.last_read_at as last_read_at,
			p.last_read_message_id as last_read_message_id
	`);

	if (updated[0]) {
		return toCursorState(updated[0]);
	}

	// The message was older than the stored cursor, or the row already covered
	// it. Read the current position back.
	const current = await tx.execute<RawCursorRow>(sql`
		select last_read_at, last_read_message_id
		from conversation_participant
		where organization_id = ${tenant.organizationId}
			and conversation_id = ${conversationId}
			and user_id = ${tenant.userId}
		limit 1
	`);

	const row = current[0];

	if (!row) {
		throw new Error("The conversation participant cursor is missing");
	}

	return toCursorState(row);
}

/**
 * Move one thread cursor to one message in that thread.
 *
 * The message can be the root or any reply. A missing row is inserted, and an
 * existing row only moves forward.
 */
export async function advanceThreadCursor(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
	rootId: string,
	messageId: string,
): Promise<CursorState> {
	const updated = await tx.execute<RawCursorRow>(sql`
		insert into conversation_thread_read (
			id,
			organization_id,
			conversation_id,
			root_message_id,
			user_id,
			last_read_at,
			last_read_message_id
		)
		select
			${randomUUID()},
			${tenant.organizationId},
			${conversationId},
			${rootId},
			${tenant.userId},
			m.created_at,
			m.id
		from conversation_message as m
		where m.organization_id = ${tenant.organizationId}
			and m.conversation_id = ${conversationId}
			and m.id = ${messageId}
			and (m.id = ${rootId} or m.parent_id = ${rootId})
		on conflict (root_message_id, user_id) do update
		set last_read_at = excluded.last_read_at,
			last_read_message_id = excluded.last_read_message_id,
			updated_at = now()
		where (
			excluded.last_read_at,
			coalesce(excluded.last_read_message_id, '')
		) > (
			conversation_thread_read.last_read_at,
			coalesce(conversation_thread_read.last_read_message_id, '')
		)
		returning last_read_at, last_read_message_id
	`);

	if (updated[0]) {
		return toCursorState(updated[0]);
	}

	const current = await tx.execute<RawCursorRow>(sql`
		select last_read_at, last_read_message_id
		from conversation_thread_read
		where organization_id = ${tenant.organizationId}
			and root_message_id = ${rootId}
			and user_id = ${tenant.userId}
		limit 1
	`);

	const row = current[0];

	if (!row) {
		throw new Error("The thread read cursor could not be written");
	}

	return toCursorState(row);
}
