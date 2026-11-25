/**
 * Conversation, participant and message tables.
 *
 * Why this file: a conversation is the container for every person to person
 * surface the product will grow into. Today only `direct` is used. A group or a
 * project level conversation is the same row shape with a different scope and
 * more participant rows, so neither needs a new table or a new read model.
 *
 * Why not the `comment` table: a comment is a milestone timeline entry. It
 * carries events, one level of replies and a milestone id that is required by a
 * check constraint. A conversation has participants instead of a project role,
 * a sequential read cursor instead of a thread root, and no events at all.
 *
 * Access boundary: this is the sensitive part of the feature. Messages are
 * readable and writable only by a participant, and only the author may change
 * or delete one. Participant rows are visible to the workspace, which is what
 * lets a reader see the other person's cursor for a read receipt without a
 * definer function. Message bodies are never visible that way.
 *
 * Used by: `db/schema/index.ts`, `services/conversation/` and the realtime
 * typing handler.
 */

import { sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgPolicy,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { appRole } from "../rls";
import { project } from "./project";

/**
 * True when the current person participates in the conversation of the row.
 *
 * Written as raw SQL on purpose: the policy lives on `conversation` and
 * `conversation_message`, while the table it reads is declared later in this
 * file. A raw subquery avoids a table object that does not exist yet and keeps
 * the generated policy readable.
 */
function participantExists(
	conversationIdColumn: string,
): ReturnType<typeof sql> {
	return sql`exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = ${sql.raw(conversationIdColumn)}
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
	)`;
}

export const conversation = pgTable(
	"conversation",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/**
		 * direct | group | project.
		 *
		 * Open ended in the check so a new scope is a small change. The service
		 * validates the value it writes.
		 */
		scope: text("scope").notNull().default("direct"),
		/** Set for a project level conversation. Null for direct and group. */
		projectId: text("project_id").references(() => project.id, {
			onDelete: "cascade",
		}),
		/** Display title. Null for a direct conversation, whose name is a person. */
		title: text("title"),
		/**
		 * Canonical `lowUserId:highUserId` for a direct conversation.
		 *
		 * Why: the same pair must resolve to one row no matter who opens it
		 * first. Sorting the two ids before joining them gives the pair one
		 * representation, so the unique index is the idempotency guard.
		 */
		pairKey: text("pair_key"),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		/**
		 * The newest message, denormalised.
		 *
		 * Why: the conversation list is the hottest read in the feature. These
		 * four columns let it render a preview and order by activity without a
		 * join to messages. They are written in the same transaction as the
		 * message insert.
		 */
		lastMessageAt: timestamp("last_message_at"),
		lastMessageId: text("last_message_id"),
		lastMessageAuthorId: text("last_message_author_id").references(
			() => user.id,
			{ onDelete: "set null" },
		),
		lastMessagePreview: text("last_message_preview").notNull().default(""),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// One row per pair per workspace. A partial index so group and project
		// conversations, which have no pair key, are unconstrained.
		uniqueIndex("conversation_org_pair_idx")
			.on(table.organizationId, table.pairKey)
			.where(sql`${table.pairKey} is not null`),
		// The conversation list orders by activity inside one workspace.
		index("conversation_org_activity_idx").on(
			table.organizationId,
			table.lastMessageAt,
		),
		index("conversation_project_idx").on(table.projectId),
		check(
			"conversation_scope_check",
			sql`${table.scope} in ('direct', 'group', 'project')`,
		),
		// A direct conversation always has a pair key. Every other scope has none,
		// so an accidental half written pair cannot exist.
		check(
			"conversation_pair_check",
			sql`(${table.scope} = 'direct' and ${table.pairKey} is not null)
				or (${table.scope} <> 'direct' and ${table.pairKey} is null)`,
		),
		/**
		 * Insert: any conversation in the current workspace.
		 *
		 * Why not participant scoped: the row is created before its participant
		 * rows exist, so an insert policy that reads participants could never be
		 * satisfied. Read and update stay participant scoped, which is what
		 * protects an existing conversation.
		 */
		pgPolicy("conversation_insert", {
			as: "permissive",
			for: "insert",
			to: appRole,
			withCheck: sql`${table.organizationId} = current_setting('app.current_org_id', true)`,
		}),
		pgPolicy("conversation_select", {
			as: "permissive",
			for: "select",
			to: appRole,
			using: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and (
					${table.createdBy} = current_setting('app.current_user_id', true)
					or ${participantExists('"conversation"."id"')}
				)`,
		}),
		pgPolicy("conversation_update", {
			as: "permissive",
			for: "update",
			to: appRole,
			using: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and (
					${table.createdBy} = current_setting('app.current_user_id', true)
					or ${participantExists('"conversation"."id"')}
				)`,
			withCheck: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and (
					${table.createdBy} = current_setting('app.current_user_id', true)
					or ${participantExists('"conversation"."id"')}
				)`,
		}),
	],
).enableRLS();

/**
 * One person's membership in one conversation, with their read cursor.
 *
 * `role` is ready for groups (an owner can add people). A direct conversation
 * gives both people `owner`, because neither owns the other.
 *
 * `last_read_at` and `last_read_message_id` are the cursor. `last_read_at` is a
 * timestamp rather than a boolean so unread is a range read on the message
 * index, and the id breaks a tie inside one millisecond.
 *
 * Rows are visible to the whole workspace on purpose: the read receipt is the
 * other participant's row, and a participant list is not secret in a workspace
 * where everyone may chat with everyone. Message bodies keep the strict rule.
 */
export const conversationParticipant = pgTable(
	"conversation_participant",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		role: text("role").notNull().default("member"),
		lastReadAt: timestamp("last_read_at").notNull().defaultNow(),
		lastReadMessageId: text("last_read_message_id"),
		/** Set when a group member leaves. Direct participants never leave. */
		leftAt: timestamp("left_at"),
		mutedAt: timestamp("muted_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("conversation_participant_conversation_user_idx").on(
			table.conversationId,
			table.userId,
		),
		// "My conversations" starts from this index.
		index("conversation_participant_user_idx").on(
			table.userId,
			table.conversationId,
		),
		index("conversation_participant_organization_idx").on(
			table.organizationId,
			table.conversationId,
		),
		check(
			"conversation_participant_role_check",
			sql`${table.role} in ('owner', 'member')`,
		),
		/*
		 * Explicit policies per command instead of `tenantIsolation`.
		 *
		 * Why: `tenantIsolation` is a permissive `for all` policy. OR-ed with the
		 * self-only update below it would widen an update to any row in the
		 * workspace, which is exactly the silent widening the notification table
		 * warns about. One policy per command keeps the write boundary at the
		 * person.
		 */
		pgPolicy("conversation_participant_select", {
			as: "permissive",
			for: "select",
			to: appRole,
			using: sql`${table.organizationId} = current_setting('app.current_org_id', true)`,
		}),
		/**
		 * The person who starts a conversation inserts both rows.
		 *
		 * A workspace scoped insert is required for that second row, and it is the
		 * same cross-user pattern as the notification writer. Reads and updates
		 * stay narrow.
		 */
		pgPolicy("conversation_participant_insert", {
			as: "permissive",
			for: "insert",
			to: appRole,
			withCheck: sql`${table.organizationId} = current_setting('app.current_org_id', true)`,
		}),
		/**
		 * Only your own cursor moves. The read route sets it, and no other person
		 * can mark a message read on your behalf.
		 */
		pgPolicy("conversation_participant_update", {
			as: "permissive",
			for: "update",
			to: appRole,
			using: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and ${table.userId} = current_setting('app.current_user_id', true)`,
			withCheck: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and ${table.userId} = current_setting('app.current_user_id', true)`,
		}),
		pgPolicy("conversation_participant_delete", {
			as: "permissive",
			for: "delete",
			to: appRole,
			using: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and ${table.userId} = current_setting('app.current_user_id', true)`,
		}),
	],
).enableRLS();

/**
 * One rich text message inside a conversation.
 *
 * `body` is the Plate value and `body_text` the plain text mirror, exactly like
 * a comment, so previews, search and unread never walk JSON.
 *
 * `client_nonce` makes a send idempotent. The browser generates it before the
 * request, so a retry after a timeout returns the original row instead of
 * posting twice. The unique index is the guard, not a check in the service.
 */
export const conversationMessage = pgTable(
	"conversation_message",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversation.id, { onDelete: "cascade" }),
		authorId: text("author_id").references(() => user.id, {
			onDelete: "set null",
		}),
		body: jsonb("body").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
		bodyText: text("body_text").notNull().default(""),
		clientNonce: text("client_nonce").notNull(),
		editedAt: timestamp("edited_at"),
		deletedAt: timestamp("deleted_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// The page read, and the unread range read, in one index.
		index("conversation_message_conversation_created_idx").on(
			table.conversationId,
			table.createdAt,
			table.id,
		),
		// Retry safety. Two requests with the same nonce cannot both insert.
		uniqueIndex("conversation_message_nonce_idx").on(
			table.conversationId,
			table.authorId,
			table.clientNonce,
		),
		index("conversation_message_organization_idx").on(table.organizationId),
		/**
		 * In conversation search.
		 *
		 * `ILIKE '%term%'` cannot use a btree. The trigram index keeps the same
		 * contains search fast, matching the project name index. The extension is
		 * created by `scripts/bootstrap-db.ts`.
		 */
		index("conversation_message_body_trgm_idx").using(
			"gin",
			sql`${table.bodyText} gin_trgm_ops`,
		),
		pgPolicy("conversation_message_select", {
			as: "permissive",
			for: "select",
			to: appRole,
			using: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and ${participantExists('"conversation_message"."conversation_id"')}`,
		}),
		pgPolicy("conversation_message_insert", {
			as: "permissive",
			for: "insert",
			to: appRole,
			withCheck: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and ${participantExists('"conversation_message"."conversation_id"')}`,
		}),
		/** Author only: the record of who said what stays honest. */
		pgPolicy("conversation_message_update", {
			as: "permissive",
			for: "update",
			to: appRole,
			using: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and ${table.authorId} = current_setting('app.current_user_id', true)`,
			withCheck: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and ${table.authorId} = current_setting('app.current_user_id', true)`,
		}),
		pgPolicy("conversation_message_delete", {
			as: "permissive",
			for: "delete",
			to: appRole,
			using: sql`${table.organizationId} = current_setting('app.current_org_id', true)
				and ${table.authorId} = current_setting('app.current_user_id', true)`,
		}),
	],
).enableRLS();
