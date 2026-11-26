/**
 * Conversation access, rate limiting and row mapping.
 *
 * Why this file: reading a thread, sending a message and moving a read cursor
 * all need the same participation check, the same cursor helpers and the same
 * author mapping. Keeping them here means those rules cannot drift between the
 * read and write modules.
 *
 * The participant check is repeated in Postgres by the row level policies. This
 * layer exists so a caller gets a clear 404 instead of an empty page, and so a
 * write fails before it reaches the database.
 *
 * Used by: the read and write modules in `services/conversation/`.
 */

import { APIError } from "better-auth/api";
import { and, eq, ne } from "drizzle-orm";
import {
	conversation,
	conversationMessage,
	conversationParticipant,
	conversationThreadRead,
} from "../../db/schema";
import type { TenantScope, TenantTx } from "../../db/tenant";
import { consumeRateLimit } from "../../lib/rate-limit";
import type { TenantContext } from "../../middleware/tenant";
import {
	getOrganizationMember,
	loadOrganizationMemberUserIds,
} from "../organization.service";
import { loadUserMap } from "../user.service";
import type {
	ConversationMessageRow,
	ConversationParticipantView,
	ConversationScope,
	ConversationThreadReadState,
} from "./types";

/** Most messages one person may send per minute. */
export const MESSAGE_RATE_LIMIT = 30;

/** Length of the send window, in seconds. */
export const MESSAGE_RATE_WINDOW = 60;

/**
 * Longest a send may wait on the throttle.
 *
 * The limiter is a safety net, not a dependency. A Redis outage must not make
 * sending hang, so the check races a short timer that answers "allowed", the
 * same rule the comment service follows.
 */
const RATE_LIMIT_TIMEOUT_MS = 300;

/** A participant row as the database stores it. */
export type ParticipantRecord = typeof conversationParticipant.$inferSelect;

/** A message row as the database stores it. */
export type MessageRecord = typeof conversationMessage.$inferSelect;

/** One conversation plus the viewer's own participant row. */
export type ConversationAccess = {
	conversation: typeof conversation.$inferSelect;
	viewer: ParticipantRecord;
	participants: ParticipantRecord[];
	/** The other person in a direct conversation. */
	counterpart: ParticipantRecord | null;
};

/** A person map entry, with the membership flag the UI needs. */
type PersonEntry = {
	name: string;
	email: string;
	image: string | null;
	isMember: boolean;
};

/**
 * Canonical pair key for a direct conversation.
 *
 * Sorting the two ids means the pair has exactly one representation, so the
 * unique index is the idempotency guard no matter who opens the chat first.
 */
export function pairKey(first: string, second: string): string {
	return [first, second].sort().join(":");
}

/** Encode a keyset cursor. */
export function encodeCursor(id: string): string {
	return Buffer.from(id, "utf8").toString("base64url");
}

/** Decode a cursor, rejecting anything this app did not produce. */
export function decodeCursor(cursor: string): string | null {
	let decoded: string;

	try {
		decoded = Buffer.from(cursor, "base64url").toString("utf8");
	} catch {
		return null;
	}

	if (decoded.length === 0 || decoded.length > 64) return null;

	return decoded;
}

/** Check the send throttle without ever blocking the write for long. */
export async function allowMessageRate(
	tenant: TenantContext,
): Promise<boolean> {
	const check = consumeRateLimit(
		`conversation-message:${tenant.userId}`,
		MESSAGE_RATE_LIMIT,
		MESSAGE_RATE_WINDOW,
	);

	const timeout = new Promise<boolean>((resolve) => {
		setTimeout(() => resolve(true), RATE_LIMIT_TIMEOUT_MS);
	});

	return Promise.race([check, timeout]);
}

/**
 * Reject a recipient who is no longer in the workspace.
 *
 * Why before the transaction: the check reads a Better Auth table on the
 * privileged client, and a send should not hold a transaction open while it
 * runs. The database policy still protects the write.
 */
export async function assertRecipientMember(
	organizationId: string,
	userId: string,
): Promise<void> {
	const member = await getOrganizationMember(organizationId, userId);

	if (!member) {
		throw new APIError("FORBIDDEN", {
			message: "That person is no longer part of this workspace.",
		});
	}
}

/**
 * Load one conversation the viewer participates in.
 *
 * The join on the viewer's participant row is the authorization check, so a
 * conversation id from another pair answers 404 instead of leaking existence.
 */
export async function requireConversation(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
): Promise<ConversationAccess> {
	const [row] = await tx
		.select({
			conversation,
			viewer: conversationParticipant,
		})
		.from(conversation)
		.innerJoin(
			conversationParticipant,
			and(
				eq(conversationParticipant.conversationId, conversation.id),
				eq(conversationParticipant.userId, tenant.userId),
			),
		)
		.where(
			and(
				eq(conversation.organizationId, tenant.organizationId),
				eq(conversation.id, conversationId),
			),
		)
		.limit(1);

	if (!row) {
		throw new APIError("NOT_FOUND", {
			message: "That conversation no longer exists.",
		});
	}

	const participants = await tx
		.select()
		.from(conversationParticipant)
		.where(
			and(
				eq(conversationParticipant.organizationId, tenant.organizationId),
				eq(conversationParticipant.conversationId, conversationId),
			),
		);

	const counterpart =
		participants.find((participant) => participant.userId !== tenant.userId) ??
		null;

	return {
		conversation: row.conversation,
		viewer: row.viewer,
		participants,
		counterpart,
	};
}

/**
 * Lightweight participation check used by the realtime typing relay.
 *
 * Returns the other participant's id, or null when the caller does not belong
 * to the conversation. No error is thrown: a socket frame that names a
 * conversation the caller cannot see is ignored, not answered.
 */
export async function loadTypingTarget(
	tx: TenantTx,
	tenant: TenantScope,
	conversationId: string,
): Promise<string | null> {
	const [mine] = await tx
		.select({ id: conversationParticipant.id })
		.from(conversationParticipant)
		.where(
			and(
				eq(conversationParticipant.organizationId, tenant.organizationId),
				eq(conversationParticipant.conversationId, conversationId),
				eq(conversationParticipant.userId, tenant.userId),
			),
		)
		.limit(1);

	if (!mine) return null;

	const [other] = await tx
		.select({ userId: conversationParticipant.userId })
		.from(conversationParticipant)
		.where(
			and(
				eq(conversationParticipant.organizationId, tenant.organizationId),
				eq(conversationParticipant.conversationId, conversationId),
				ne(conversationParticipant.userId, tenant.userId),
			),
		)
		.limit(1);

	return other?.userId ?? null;
}

/**
 * Load one message inside one conversation.
 *
 * The conversation id is part of the filter, not only the message id, so a
 * crafted request cannot edit a message through a conversation it does not
 * belong to.
 */
export async function loadMessageRecord(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
	messageId: string,
): Promise<MessageRecord | null> {
	const [record] = await tx
		.select()
		.from(conversationMessage)
		.where(
			and(
				eq(conversationMessage.organizationId, tenant.organizationId),
				eq(conversationMessage.conversationId, conversationId),
				eq(conversationMessage.id, messageId),
			),
		)
		.limit(1);

	return record ?? null;
}

/**
 * Load a message by its idempotency key.
 *
 * Used when a retried send hits the unique nonce index. Returning the original
 * row makes the retry a success from the browser's point of view instead of an
 * error the writer would have to understand.
 */
export async function loadMessageByNonce(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
	authorId: string,
	clientNonce: string,
): Promise<MessageRecord | null> {
	const [record] = await tx
		.select()
		.from(conversationMessage)
		.where(
			and(
				eq(conversationMessage.organizationId, tenant.organizationId),
				eq(conversationMessage.conversationId, conversationId),
				eq(conversationMessage.authorId, authorId),
				eq(conversationMessage.clientNonce, clientNonce),
			),
		)
		.limit(1);

	return record ?? null;
}

/** Read a person's cursor for one thread. Missing means nothing is read. */
export async function loadThreadRead(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
	rootId: string,
	userId: string,
): Promise<ConversationThreadReadState> {
	const [row] = await tx
		.select({
			lastReadAt: conversationThreadRead.lastReadAt,
			lastReadMessageId: conversationThreadRead.lastReadMessageId,
		})
		.from(conversationThreadRead)
		.where(
			and(
				eq(conversationThreadRead.organizationId, tenant.organizationId),
				eq(conversationThreadRead.conversationId, conversationId),
				eq(conversationThreadRead.rootMessageId, rootId),
				eq(conversationThreadRead.userId, userId),
			),
		)
		.limit(1);

	return {
		lastReadAt: row ? row.lastReadAt.toISOString() : null,
		lastReadMessageId: row?.lastReadMessageId ?? null,
	};
}

/** Read a participant row for one person, or null. */
export async function loadParticipant(
	tx: TenantTx,
	tenant: TenantContext,
	conversationId: string,
	userId: string,
): Promise<ParticipantRecord | null> {
	const [row] = await tx
		.select()
		.from(conversationParticipant)
		.where(
			and(
				eq(conversationParticipant.organizationId, tenant.organizationId),
				eq(conversationParticipant.conversationId, conversationId),
				eq(conversationParticipant.userId, userId),
			),
		)
		.limit(1);

	return row ?? null;
}

/** Load the display names and membership state for a set of people. */ export async function loadPeople(
	organizationId: string,
	userIds: (string | null)[],
): Promise<Map<string, PersonEntry>> {
	const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];

	const [people, memberIds] = await Promise.all([
		loadUserMap(ids),
		loadOrganizationMemberUserIds(organizationId, ids),
	]);

	// Every id gets an entry, so the mapper can tell "former member" from a
	// missing author without a second lookup.
	return new Map(
		ids.map((id) => {
			const person = people.get(id);

			return [
				id,
				{
					name: person?.name ?? "",
					email: person?.email ?? "",
					image: person?.image ?? null,
					isMember: memberIds.has(id),
				},
			];
		}),
	);
}

/** Map one participant row into the wire shape. */
export function toParticipantView(
	record: ParticipantRecord,
	people: Map<string, PersonEntry>,
): ConversationParticipantView {
	const person = people.get(record.userId);

	return {
		userId: record.userId,
		name: person?.name || person?.email || "Former member",
		image: person?.image ?? null,
		isMember: person?.isMember ?? false,
		role: record.role === "owner" ? "owner" : "member",
		lastReadAt: record.lastReadAt.toISOString(),
		lastReadMessageId: record.lastReadMessageId,
	};
}

/** Map one message row into the wire shape. */
export function toMessageRow(
	record: MessageRecord,
	people: Map<string, PersonEntry>,
	viewerId: string,
): ConversationMessageRow {
	const person = record.authorId ? people.get(record.authorId) : undefined;
	const deleted = record.deletedAt !== null;
	const mine = record.authorId === viewerId && !deleted;

	return {
		id: record.id,
		conversationId: record.conversationId,
		parentId: record.parentId,
		body: deleted ? [] : record.body,
		author: record.authorId
			? {
					id: record.authorId,
					name: person?.name || person?.email || "Former member",
					image: person?.image ?? null,
					isMember: person?.isMember ?? false,
				}
			: null,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
		editedAt: record.editedAt ? record.editedAt.toISOString() : null,
		deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
		canEdit: mine,
		canDelete: mine,
	};
}

/** Read a scope value without trusting the stored string. */
export function toScope(value: string): ConversationScope {
	if (value === "group" || value === "project") return value;

	return "direct";
}
