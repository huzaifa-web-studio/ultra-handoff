/**
 * Conversation routes.
 *
 * Why a separate file from comments: a conversation is workspace scoped, not
 * project scoped, and it has its own access rule (participation), paging and
 * realtime payloads. Keeping it here means either file can be read alone.
 *
 * The routes only parse input and translate failures. Every rule lives in
 * `services/conversation/`, and the tenant macro guarantees `:orgSlug` was
 * resolved from a verified membership before a handler runs.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import { publishUserEvent } from "../realtime";
import {
	type ConversationMessageRealtimePayload,
	type ConversationReadPayload,
	toRealtimeConversationMessage,
} from "../realtime/events";
import type { RealtimeEventType } from "../realtime/protocol";
import {
	type ConversationListQuery,
	type ConversationReadResult,
	createConversationMessage,
	deleteConversationMessage,
	editConversationMessage,
	getConversation,
	listContacts,
	listConversationRoots,
	listConversations,
	listThreadReplies,
	type MessagePageQuery,
	markConversationRead,
	markThreadRead,
	openDirectConversation,
	searchConversationMessages,
} from "../services/conversation";
import { dispatchNotificationDeliveries } from "../services/notification-dispatch.service";

/** One conversation in the URL. */
const conversationParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	conversationId: t.String({ minLength: 1, maxLength: 64 }),
});

/** One message inside a conversation. */
const messageParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	conversationId: t.String({ minLength: 1, maxLength: 64 }),
	messageId: t.String({ minLength: 1, maxLength: 64 }),
});

/** One thread inside a conversation. */
const threadParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	conversationId: t.String({ minLength: 1, maxLength: 64 }),
	rootId: t.String({ minLength: 1, maxLength: 64 }),
});

const listQuery = t.Object({
	cursor: t.Optional(t.String({ maxLength: 200 })),
	limit: t.Optional(t.String()),
});

const pageQuery = t.Object({
	before: t.Optional(t.String({ maxLength: 64 })),
	after: t.Optional(t.String({ maxLength: 64 })),
	around: t.Optional(t.String({ maxLength: 64 })),
	limit: t.Optional(t.String()),
});

const threadQuery = t.Object({
	before: t.Optional(t.String({ maxLength: 64 })),
	around: t.Optional(t.String({ maxLength: 64 })),
	limit: t.Optional(t.String()),
});

const searchQuery = t.Object({
	q: t.Optional(t.String({ maxLength: 100 })),
	limit: t.Optional(t.String()),
});

const contactsQuery = t.Object({
	search: t.Optional(t.String({ maxLength: 100 })),
	limit: t.Optional(t.String()),
});

/**
 * The editor value.
 *
 * Deliberately untyped at the HTTP layer: the shape is a Plate document, and
 * the sanitizer in the service is the authority on what is accepted.
 */
const bodyField = t.Unknown();

/** Clamp a page size instead of trusting the browser. */
function clampLimit(value: string | undefined, fallback: number, max: number) {
	const parsed = Number.parseInt(value ?? "", 10);

	return Number.isFinite(parsed)
		? Math.min(max, Math.max(1, parsed))
		: fallback;
}

function parseListQuery(query: {
	cursor?: string;
	limit?: string;
}): ConversationListQuery {
	return {
		cursor: query.cursor ?? null,
		limit: clampLimit(query.limit, 20, 50),
	};
}

function parsePageQuery(query: {
	before?: string;
	after?: string;
	around?: string;
	limit?: string;
}): MessagePageQuery {
	// Only one direction is meaningful. Precedence keeps a hand edited link
	// deterministic instead of silently combining two cursors.
	const before = query.before ?? null;
	const after = before ? null : (query.after ?? null);
	const around = before || after ? null : (query.around ?? null);

	return {
		before,
		after,
		around,
		limit: clampLimit(query.limit, 40, 60),
	};
}

/** One thread page. A thread has no forward cursor, only older replies. */
function parseThreadQuery(query: {
	before?: string;
	around?: string;
	limit?: string;
}): MessagePageQuery {
	const before = query.before ?? null;
	const around = before ? null : (query.around ?? null);

	return {
		before,
		after: null,
		around,
		limit: clampLimit(query.limit, 40, 60),
	};
}

/**
 * Publish one conversation event to each participant.
 *
 * Why after the service returns: the transaction has committed, and a realtime
 * failure must never turn a saved message into an error. Publishing never
 * rejects.
 */
function publishToParticipants(
	organizationId: string,
	userIds: string[],
	type: RealtimeEventType,
	data: unknown,
): void {
	for (const userId of new Set(userIds)) {
		void publishUserEvent(organizationId, userId, type, data).catch(
			() => undefined,
		);
	}
}

/** Publish one cursor move, conversation or thread. */
function publishRead(
	tenant: { organizationId: string; userId: string },
	result: ConversationReadResult,
): void {
	const payload: ConversationReadPayload = {
		conversationId: result.conversationId,
		threadRootId: result.threadRootId,
		userId: tenant.userId,
		lastReadAt: result.lastReadAt,
		lastReadMessageId: result.lastReadMessageId,
	};

	publishToParticipants(
		tenant.organizationId,
		result.participantIds,
		"conversation.read",
		payload,
	);
}

export const conversationRoutes = new Elysia({ name: "conversations" })
	.use(tenantPlugin)
	/** One page of the sidebar list, newest activity first. */
	.get(
		"/orgs/:orgSlug/conversations",
		async ({ tenant, status, query }) => {
			try {
				return await listConversations(tenant, parseListQuery(query));
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not load your conversations.",
					),
				});
			}
		},
		{ tenant: true, query: listQuery },
	)
	/**
	 * Everyone you can start a conversation with.
	 *
	 * Registered before `:conversationId` so the static segment always wins.
	 */
	.get(
		"/orgs/:orgSlug/conversations/contacts",
		async ({ tenant, status, query }) => {
			try {
				return {
					contacts: await listContacts(tenant, {
						search: query.search ?? "",
						limit: clampLimit(query.limit, 40, 50),
					}),
				};
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not load the people you can message.",
					),
				});
			}
		},
		{ tenant: true, query: contactsQuery },
	)
	/** Resolve the direct conversation with one person, creating it if needed. */
	.post(
		"/orgs/:orgSlug/conversations",
		async ({ tenant, status, body }) => {
			try {
				return {
					conversation: await openDirectConversation(tenant, body.userId),
				};
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not open that conversation."),
				});
			}
		},
		{
			tenant: true,
			body: t.Object({
				userId: t.String({ minLength: 1, maxLength: 64 }),
			}),
		},
	)
	/** One conversation header. */
	.get(
		"/orgs/:orgSlug/conversations/:conversationId",
		async ({ tenant, status, params }) => {
			try {
				return await getConversation(tenant, params.conversationId);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load that conversation."),
				});
			}
		},
		{ tenant: true, params: conversationParams },
	)
	/** One page of root messages, oldest first inside the page. */
	.get(
		"/orgs/:orgSlug/conversations/:conversationId/messages",
		async ({ tenant, status, params, query }) => {
			try {
				return await listConversationRoots(
					tenant,
					params.conversationId,
					parsePageQuery(query),
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the messages."),
				});
			}
		},
		{ tenant: true, params: conversationParams, query: pageQuery },
	)
	/** One complete thread, root and a page of replies. */
	.get(
		"/orgs/:orgSlug/conversations/:conversationId/threads/:rootId",
		async ({ tenant, status, params, query }) => {
			try {
				return await listThreadReplies(
					tenant,
					params.conversationId,
					params.rootId,
					parseThreadQuery(query),
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the thread."),
				});
			}
		},
		{ tenant: true, params: threadParams, query: threadQuery },
	)
	/** Search inside one conversation. */
	.get(
		"/orgs/:orgSlug/conversations/:conversationId/search",
		async ({ tenant, status, params, query }) => {
			try {
				return await searchConversationMessages(tenant, params.conversationId, {
					search: query.q ?? "",
					limit: clampLimit(query.limit, 20, 25),
				});
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not search this conversation.",
					),
				});
			}
		},
		{ tenant: true, params: conversationParams, query: searchQuery },
	)
	/** Send a message. */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/messages",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await createConversationMessage(
					tenant,
					params.conversationId,
					body,
				);

				const payload: ConversationMessageRealtimePayload = {
					conversationId: params.conversationId,
					message: toRealtimeConversationMessage(result.message),
					conversation: result.created ? result.conversation : null,
					senderId: tenant.userId,
				};

				publishToParticipants(
					tenant.organizationId,
					[tenant.userId, result.recipientUserId],
					"conversation.message.created",
					payload,
				);
				dispatchNotificationDeliveries(result.notifications);

				return {
					message: result.message,
					created: result.created,
					conversation: result.conversation,
				};
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not send the message."),
				});
			}
		},
		{
			tenant: true,
			params: conversationParams,
			body: t.Object({
				body: bodyField,
				clientNonce: t.String({ minLength: 1, maxLength: 64 }),
				parentId: t.Optional(
					t.Union([t.String({ minLength: 1, maxLength: 64 }), t.Null()]),
				),
			}),
		},
	)
	/** Change the body of your own message. */
	.patch(
		"/orgs/:orgSlug/conversations/:conversationId/messages/:messageId",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await editConversationMessage(
					tenant,
					params.conversationId,
					params.messageId,
					body,
				);

				publishToParticipants(
					tenant.organizationId,
					result.participantIds,
					"conversation.message.updated",
					{
						conversationId: params.conversationId,
						message: toRealtimeConversationMessage(result.message),
						conversation: null,
						senderId: tenant.userId,
					} satisfies ConversationMessageRealtimePayload,
				);

				return { message: result.message };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not save the message."),
				});
			}
		},
		{
			tenant: true,
			params: messageParams,
			body: t.Object({ body: bodyField }),
		},
	)
	/** Soft delete your own message. */
	.delete(
		"/orgs/:orgSlug/conversations/:conversationId/messages/:messageId",
		async ({ tenant, status, params }) => {
			try {
				const result = await deleteConversationMessage(
					tenant,
					params.conversationId,
					params.messageId,
				);

				publishToParticipants(
					tenant.organizationId,
					result.participantIds,
					"conversation.message.deleted",
					{
						conversationId: params.conversationId,
						message: toRealtimeConversationMessage(result.message),
						conversation: null,
						senderId: tenant.userId,
					} satisfies ConversationMessageRealtimePayload,
				);

				return { message: result.message };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not delete the message."),
				});
			}
		},
		{ tenant: true, params: messageParams },
	)
	/**
	 * Move the viewer's read cursor to one message.
	 *
	 * The body carries an id, not a timestamp. The server resolves it inside the
	 * conversation, so a forged or stale id cannot move the cursor to an
	 * arbitrary point in time.
	 */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/read",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await markConversationRead(
					tenant,
					params.conversationId,
					body.messageId,
				);

				publishRead(tenant, result);

				return {
					conversationId: result.conversationId,
					lastReadAt: result.lastReadAt,
					lastReadMessageId: result.lastReadMessageId,
					unread: result.unread,
				};
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not update the read state."),
				});
			}
		},
		{
			tenant: true,
			params: conversationParams,
			body: t.Object({
				messageId: t.String({ minLength: 1, maxLength: 64 }),
			}),
		},
	)
	/**
	 * Move one thread's read cursor.
	 *
	 * A thread cursor is separate from the conversation cursor, so opening the
	 * conversation never marks replies read.
	 */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/threads/:rootId/read",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await markThreadRead(
					tenant,
					params.conversationId,
					params.rootId,
					body.messageId,
				);

				publishRead(tenant, result);

				return {
					conversationId: result.conversationId,
					threadRootId: result.threadRootId,
					lastReadAt: result.lastReadAt,
					lastReadMessageId: result.lastReadMessageId,
					unread: result.unread,
				};
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not update the read state."),
				});
			}
		},
		{
			tenant: true,
			params: threadParams,
			body: t.Object({
				messageId: t.String({ minLength: 1, maxLength: 64 }),
			}),
		},
	);
