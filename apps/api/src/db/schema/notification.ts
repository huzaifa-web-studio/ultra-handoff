/**
 * Notification table.
 *
 * Why this file: a notification is addressed to one person and carries its
 * subject ids. Keeping it separate makes the recipient scoped policy obvious.
 *
 * Used by: `db/schema/index.ts` and the notification services.
 */

import { sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { NOTIFICATION_TYPE_SQL_VALUES } from "../../lib/notification-types";
import { organization, user } from "../auth-schema";
import { notificationPolicies } from "../rls";
import { changeRequest, milestoneScopeEntry } from "./change-request";
import { comment } from "./comment";
import { milestone } from "./milestone";
import { project } from "./project";

export const notification = pgTable(
	"notification",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		recipientUserId: text("recipient_user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Null for a system reminder or when the actor's account is deleted. */
		actorUserId: text("actor_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		type: text("type").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		projectId: text("project_id").references(() => project.id, {
			onDelete: "cascade",
		}),
		milestoneId: text("milestone_id").references(() => milestone.id, {
			onDelete: "cascade",
		}),
		commentId: text("comment_id").references(() => comment.id, {
			onDelete: "cascade",
		}),
		changeRequestId: text("change_request_id").references(
			() => changeRequest.id,
			{ onDelete: "cascade" },
		),
		scopeEntryId: text("scope_entry_id").references(
			() => milestoneScopeEntry.id,
			{ onDelete: "cascade" },
		),
		data: jsonb("data")
			.$type<Record<string, string | number | boolean | null>>()
			.notNull()
			.default(sql`'{}'::jsonb`),
		/** Null while unread. The bell's unread count is a partial index read. */
		readAt: timestamp("read_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// The idempotency guard for one recipient.
		uniqueIndex("notification_recipient_dedupe_idx").on(
			table.recipientUserId,
			table.dedupeKey,
		),
		// The bell and the full page, newest first, with the id as tiebreaker.
		index("notification_recipient_created_idx").on(
			table.recipientUserId,
			table.createdAt,
			table.id,
		),
		// The unread badge. Partial so the count never walks read history, and
		// ordered so the one scan can also answer the unread list.
		index("notification_recipient_unread_idx")
			.on(
				table.recipientUserId,
				table.organizationId,
				table.createdAt,
				table.id,
			)
			.where(sql`${table.readAt} is null`),
		// Per project counts for the sidebar and the project list.
		index("notification_recipient_project_unread_idx")
			.on(table.recipientUserId, table.projectId)
			.where(sql`${table.readAt} is null`),
		index("notification_organization_idx").on(table.organizationId),
		// Cascade deletes and subject cleanup filters stay indexed.
		index("notification_project_idx").on(table.projectId),
		index("notification_milestone_idx").on(table.milestoneId),
		index("notification_comment_idx").on(table.commentId),
		index("notification_change_request_idx").on(table.changeRequestId),
		index("notification_scope_entry_idx").on(table.scopeEntryId),
		check(
			"notification_type_check",
			sql`${table.type} in (${sql.raw(NOTIFICATION_TYPE_SQL_VALUES)})`,
		),
		notificationPolicies({
			organizationColumn: table.organizationId,
			recipientColumn: table.recipientUserId,
		}),
	],
).enableRLS();

/**
 * How far one person has read one discussion thread.
 *
 * Why a cursor per thread instead of a boolean per comment: the product needs
 * "the oldest message I have not read", including inside a reply thread. One
 * monotonic cursor answers that with a single row, exactly like a chat read
 * marker, and it cannot disagree with itself the way a per message set can.
 *
 * `root_comment_id` is the thread root (`parent_id ?? id`). Replies share the
 * cursor of their root, so expanding a thread marks the whole thread in one
 * write.
 *
 * The cursor is intentionally monotonic. `mark read up to X` never moves a
 * cursor backwards, which is what makes two open tabs safe.
 *
 * `last_read_at` is a plain `timestamp` on purpose. It is a copy of
 * `comment.created_at`, and comparing a `timestamp` with a `timestamptz`
 * would shift with the session timezone.
 */
