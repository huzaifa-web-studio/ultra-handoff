/**
 * Milestone, phase and assignee tables.
 *
 * Why this file: a milestone row, its status periods and its assignees are
 * written together by the milestone service. Keeping them in one file means the
 * phase timing and the assignee set cannot disagree about which milestone they
 * belong to.
 *
 * Used by: `db/schema/index.ts` and the milestone services.
 */

import { sql } from "drizzle-orm";
import {
	check,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "../auth-schema";
import { tenantIsolation } from "../rls";
import { project, projectMember } from "./project";

export const milestone = pgTable(
	"milestone",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		/** Plate value. Always an array; the service validates before writing. */
		description: jsonb("description")
			.$type<unknown[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		/** Plain text mirror of `description`, used by search and previews. */
		descriptionText: text("description_text").notNull().default(""),
		/**
		 * todo | in_development | in_testing | ready | in_review | blocked |
		 * done | cancelled, checked below.
		 */
		status: text("status").notNull().default("todo"),
		/** Both nullable: a milestone can exist before it is scheduled. */
		startDate: date("start_date"),
		dueDate: date("due_date"),
		/** Null means "no estimate". Minutes keep totals exact. */
		estimateMinutes: integer("estimate_minutes"),
		/** Set when the status becomes done, cleared on every other status. */
		completedAt: timestamp("completed_at"),
		/** Null while unlocked. Set together with `locked_by`. */
		lockedAt: timestamp("locked_at"),
		lockedBy: text("locked_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		updatedBy: text("updated_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// Every list is "the milestones of one project", so this is the primary
		// read path, with status and due date carrying the filter and sort.
		index("milestone_project_status_due_idx").on(
			table.projectId,
			table.status,
			table.dueDate,
		),
		index("milestone_organization_idx").on(table.organizationId),
		/**
		 * The reminder sweep reads one workspace's milestones by due date.
		 *
		 * The existing list index starts with `project_id`, so a workspace wide
		 * "what is due soon" query cannot use it. This one matches the sweep.
		 */
		index("milestone_organization_due_idx").on(
			table.organizationId,
			table.dueDate,
		),
		/**
		 * Substring search for the mention picker. The picker searches titles
		 * across every visible project, so without a trigram index a large
		 * workspace would scan the whole table on each keystroke.
		 */
		index("milestone_title_trgm_idx").using(
			"gin",
			sql`${table.title} gin_trgm_ops`,
		),
		check(
			"milestone_status_check",
			sql`${table.status} in ('todo', 'in_development', 'in_testing', 'ready', 'in_review', 'blocked', 'done', 'cancelled')`,
		),
		check(
			"milestone_estimate_check",
			sql`${table.estimateMinutes} is null or (${table.estimateMinutes} > 0 and ${table.estimateMinutes} <= 60000)`,
		),
		// The API validates the range too. This keeps an inverted range out even
		// if a future code path forgets to call the validator.
		check(
			"milestone_dates_check",
			sql`${table.startDate} is null or ${table.dueDate} is null or ${table.startDate} <= ${table.dueDate}`,
		),
		tenantIsolation(table.organizationId),
	],
).enableRLS();

/**
 * One continuous stay in a milestone status.
 *
 * Why a dedicated table instead of deriving durations from the activity
 * timeline: the timeline is a discussion surface and a row can be blanked or
 * hidden by future features. A period row is the durable record the product
 * needs to answer "how long did this spend in testing", including across DST
 * and repeated visits to the same status.
 *
 * `timestamptz` is deliberate. The one thing this table exists for is a
 * duration, and a wall clock column would shift the duration when the database
 * timezone or DST changes. The rest of the schema can stay as it is.
 *
 * `exited_at` is null exactly while the milestone is in that status. The
 * partial unique index makes "one open period per milestone" a database
 * invariant, not a convention the service could forget.
 *
 * `entered_by` uses `set null` so deleting an account keeps the timing record.
 */
export const milestoneStatusPeriod = pgTable(
	"milestone_status_period",
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
		status: text("status").notNull(),
		enteredAt: timestamp("entered_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		exitedAt: timestamp("exited_at", { withTimezone: true }),
		enteredBy: text("entered_by").references(() => user.id, {
			onDelete: "set null",
		}),
		/** The status note, such as a blocked or cancellation reason. */
		note: text("note"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		// The detail read: every period of one milestone in order.
		index("milestone_status_period_milestone_idx").on(
			table.milestoneId,
			table.enteredAt,
		),
		// Makes "where does this project spend its time" a cheap aggregate later.
		index("milestone_status_period_project_status_idx").on(
			table.projectId,
			table.status,
			table.enteredAt,
		),
		index("milestone_status_period_organization_idx").on(table.organizationId),
		// Exactly one open period per milestone, enforced for every writer.
		uniqueIndex("milestone_status_period_open_idx")
			.on(table.milestoneId)
			.where(sql`${table.exitedAt} is null`),
		check(
			"milestone_status_period_status_check",
			sql`${table.status} in ('todo', 'in_development', 'in_testing', 'ready', 'in_review', 'blocked', 'done', 'cancelled')`,
		),
		check(
			"milestone_status_period_range_check",
			sql`${table.exitedAt} is null or ${table.exitedAt} >= ${table.enteredAt}`,
		),
		tenantIsolation(table.organizationId),
	],
).enableRLS();

/**
 * Who is assigned to a milestone.
 *
 * Why a join table: a milestone can have several assignees, and an assignee is
 * a project member, not a loose user id.
 *
 * The foreign key points at `project_member.id`, so leaving the project, being
 * removed from the organization, or deleting the account removes the
 * assignment through the existing cascade chain. No cleanup code, and no way
 * to forget a cleanup path when a new removal flow is added.
 *
 * The unique index makes a replace-set write idempotent.
 */
export const milestoneAssignee = pgTable(
	"milestone_assignee",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		milestoneId: text("milestone_id")
			.notNull()
			.references(() => milestone.id, { onDelete: "cascade" }),
		projectMemberId: text("project_member_id")
			.notNull()
			.references(() => projectMember.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("milestone_assignee_milestone_member_idx").on(
			table.milestoneId,
			table.projectMemberId,
		),
		index("milestone_assignee_organization_idx").on(table.organizationId),
		index("milestone_assignee_milestone_idx").on(table.milestoneId),
		// Supports "my milestones" style reads and the member removal cascade.
		index("milestone_assignee_member_idx").on(table.projectMemberId),
		tenantIsolation(table.organizationId),
	],
).enableRLS();

/**
 * A comment in a discussion thread attached to a piece of work.
 *
 * Why one generic table instead of a milestone specific one: comments are the
 * same concept on every surface the product will grow (milestones now,
 * deliverables and scope items later). One table keeps one service, one route
 * shape and one UI, and the thread features that follow (reactions,
 * attachments, resolve) only need child tables keyed by comment id.
 *
 * Why typed target columns instead of an `entity_type` + `entity_id` pair: the
 * foreign key is what makes deletion safe. Deleting a milestone, or a project
 * that owns it, removes its comments inside the database, including on cascade
 * paths no service code runs through. An untyped id would leave orphan rows
 * behind. The check keeps the target exclusive, so a row can never point at two
 * entities at once. Adding the next entity means one column, one check update
 * and one index.
 *
 * `parent_id` is a self reference. A reply points at a root comment whose own
 * parent is null; the service enforces that, so the depth stays one level and
 * the schema does not need to encode it.
 *
 * `body` holds the Plate value and `body_text` the plain text mirror, exactly
 * like a milestone description, so search, previews and validation never have
 * to walk JSON.
 *
 * Deleting is soft. `deleted_at` keeps the row so replies keep their thread and
 * the record of who said something remains, while the service blanks `body` and
 * `body_text` so the content itself is gone.
 *
 * `author_id` is nullable and uses `set null`, so removing an account keeps the
 * discussion history as "Former member" instead of deleting it.
 */
