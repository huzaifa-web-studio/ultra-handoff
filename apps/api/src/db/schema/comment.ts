/**
 * Comment and read cursor tables.
 *
 * Why this file: a comment row and the per thread read cursor are read together
 * by the discussion pane. Keeping them together makes the thread root contract
 * visible.
 *
 * Used by: `db/schema/index.ts` and the comment services.
 */

import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { tenantIsolation, userIsolation } from "../rls";
import { milestone } from "./milestone";
import { project } from "./project";

export const comment = pgTable(
	"comment",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** The milestone this thread belongs to. Null for future targets. */
		milestoneId: text("milestone_id").references(() => milestone.id, {
			onDelete: "cascade",
		}),
		/** The root comment this row replies to. Null for a root. */
		parentId: text("parent_id").references((): AnyPgColumn => comment.id, {
			onDelete: "cascade",
		}),
		authorId: text("author_id").references(() => user.id, {
			onDelete: "set null",
		}),
		/**
		 * "comment" for a person's message, "event" for a milestone activity
		 * entry. An event is shown in the same timeline but is not a message:
		 * it has no body, no replies and no edit or delete action.
		 */
		kind: text("kind").notNull().default("comment"),
		/**
		 * status | start_date | due_date | assignee_added | assignee_removed |
		 * estimate_minutes | milestone_locked | milestone_unlocked |
		 * change_request_created | change_request_accepted |
		 * change_request_declined | change_request_moved |
		 * change_request_withdrawn, only when kind is "event".
		 */
		eventType: text("event_type"),
		/** Previous value. Null means the field was empty. */
		eventFrom: text("event_from"),
		/** New value. Null means the field was cleared. */
		eventTo: text("event_to"),
		/**
		 * Optional plain text note attached to an event.
		 *
		 * Why its own column: a lock reason, a blocked reason and a decline
		 * reason are prose, not a from/to value. Reusing `event_from` or
		 * `event_to` would make the timeline render a reason as a field value
		 * and break the meaning of an edit event.
		 */
		eventNote: text("event_note"),
		/** Plate value. Always an array; the service validates before writing. */
		body: jsonb("body").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
		/** Plain text mirror used by previews, search and validation. */
		bodyText: text("body_text").notNull().default(""),
		/** Set the first time the author saves an edit. */
		editedAt: timestamp("edited_at"),
		/** Set when the author deletes. The body is blanked at the same time. */
		deletedAt: timestamp("deleted_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// The thread read: roots and their replies inside one milestone.
		index("comment_milestone_created_idx").on(
			table.milestoneId,
			table.parentId,
			table.createdAt,
			table.id,
		),
		index("comment_parent_idx").on(table.parentId),
		index("comment_organization_idx").on(table.organizationId),
		// Supports the author permission check and a future "my comments" view.
		index("comment_author_idx").on(table.authorId),
		/**
		 * Discussion search.
		 *
		 * Same reason as the project name index: `ILIKE '%term%'` cannot use a
		 * btree, so the trigram GIN keeps the contains search fast. The extension
		 * is created by `scripts/bootstrap-db.ts`.
		 */
		index("comment_body_trgm_idx").using(
			"gin",
			sql`${table.bodyText} gin_trgm_ops`,
		),
		// Exactly one target. Adding the next entity extends this list.
		check("comment_target_check", sql`num_nonnulls(${table.milestoneId}) = 1`),
		check("comment_kind_check", sql`${table.kind} in ('comment', 'event')`),
		// A message has no event columns; an event names one of the fields the
		// timeline can render.
		check(
			"comment_event_check",
			sql`(
				${table.kind} = 'comment'
				and ${table.eventType} is null
				and ${table.eventFrom} is null
				and ${table.eventTo} is null
				and ${table.eventNote} is null
			) or (
				${table.kind} = 'event'
				and ${table.eventType} in (
					'status', 'start_date', 'due_date', 'assignee_added',
					'assignee_removed', 'estimate_minutes', 'milestone_locked',
					'milestone_unlocked', 'change_request_created',
					'change_request_accepted', 'change_request_declined',
					'change_request_moved', 'change_request_withdrawn'
				)
			)`,
		),
		// An event is a root timeline row. Replies only belong to messages.
		check(
			"comment_event_parent_check",
			sql`${table.kind} = 'comment' or ${table.parentId} is null`,
		),
		tenantIsolation(table.organizationId),
	],
).enableRLS();

/**
 * A client request to change the agreed work of a milestone.
 *
 * Why its own table and not a comment: a request is a structured record with a
 * decision. The client asks, the agency accepts, declines or moves it, and the
 * answer stays attached to the question. Comments remain the free form
 * discussion, so neither surface has to carry the other's state.
 *
 * Why it is not covered by the milestone lock: the whole point is that the
 * client can still ask for work while the scope is frozen. The request never
 * edits the milestone, so the lock has nothing to protect here.
 *
 * `body` holds the Plate value and `body_text` the plain text mirror, exactly
 * like a comment, so previews and list rows never walk JSON.
 *
 * `target_milestone_id` is set when the request is moved. It uses `set null`
 * rather than `cascade`: deleting the new milestone must not delete the record
 * of what the client asked for.
 *
 * `requested_by` and `decided_by` use `set null`, so removing an account keeps
 * the request history as "Former member" instead of deleting it.
 */

export const commentThreadRead = pgTable(
	"comment_thread_read",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		milestoneId: text("milestone_id")
			.notNull()
			.references(() => milestone.id, { onDelete: "cascade" }),
		rootCommentId: text("root_comment_id")
			.notNull()
			.references(() => comment.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		lastReadAt: timestamp("last_read_at").notNull(),
		lastReadCommentId: text("last_read_comment_id")
			.notNull()
			.references(() => comment.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// The conflict target for the monotonic upsert.
		uniqueIndex("comment_thread_read_root_user_idx").on(
			table.rootCommentId,
			table.userId,
		),
		// The comments tab and project unread summary read one person's cursors.
		index("comment_thread_read_user_milestone_idx").on(
			table.userId,
			table.milestoneId,
		),
		index("comment_thread_read_organization_idx").on(table.organizationId),
		index("comment_thread_read_project_idx").on(table.projectId),
		userIsolation(table.userId),
	],
).enableRLS();

/**
 * One browser's Web Push subscription.
 *
 * Why this table has no `organization_id`: a push subscription is a device
 * token, not workspace business data. The same browser should receive every
 * workspace's alerts with one subscription. The row is protected by a user-only
 * policy instead of the tenant policy, and routes reach it through `withUser`.
 *
 * `endpoint` is globally unique. Signing in as a different person on the same
 * browser updates the row's `user_id`, which is what stops the previous person
 * from receiving pushes on a shared device.
 *
 * `failure_count` lets the sender delete a subscription that the push service
 * keeps rejecting, instead of retrying a dead endpoint forever.
 */
