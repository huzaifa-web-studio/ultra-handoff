/**
 * Business tables (Handoff owned data).
 *
 * Scope: everything Handoff owns. Better Auth tables (`user`, `session`,
 * `account`, `verification`, `organization`, `member`, `invitation`) live in
 * auth-schema.ts and are only touched through the auth API.
 *
 * Every table here carries `organization_id`, an index on it and the
 * `tenantIsolation` policy, then enables row level security. Queries run as
 * the unprivileged `app_tenant` role through `withTenant`, so the policy is
 * what enforces the workspace boundary.
 *
 * Used by: src/db/schema-bundle.ts, src/services/project.service.ts.
 */

import { sql } from "drizzle-orm";
import {
	boolean,
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
import { member, organization, user } from "./auth-schema";
import { tenantIsolation } from "./rls";

/**
 * A client engagement inside one workspace.
 *
 * `archived_at` is the lifecycle flag. It is a nullable timestamp rather than
 * an enum so the archive moment stays auditable and "active" is simply
 * `archived_at is null`. Deleting a project is a hard delete; archiving is the
 * reversible option.
 *
 * `archive_visible_to_client` is the per project exception to the archive rule.
 * An archived project is hidden from project members and clients by default.
 * Turning this on keeps it visible to the `client` role only, read only. Project
 * members never see an archived project, and owners and admins always do.
 *
 * `created_by` is nullable on purpose: deleting the creator's account must not
 * delete the projects they created, so the foreign key clears instead.
 */
export const project = pgTable(
	"project",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		/** Optional short summary shown when editing the project. */
		description: text("description"),
		logo: text("logo"),
		archivedAt: timestamp("archived_at"),
		/**
		 * Keep an archived project visible to its clients.
		 *
		 * Off by default, so archiving removes the project from the client's
		 * view. Owners and admins are unaffected, and the `member` role never
		 * sees archived projects.
		 */
		archiveVisibleToClient: boolean("archive_visible_to_client")
			.default(false)
			.notNull(),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// Unique per workspace, not globally: two organizations may both have
		// a project called "website-redesign".
		uniqueIndex("project_organization_slug_idx").on(
			table.organizationId,
			table.slug,
		),
		index("project_organization_idx").on(table.organizationId),
		index("project_organization_archived_idx").on(
			table.organizationId,
			table.archivedAt,
		),
		// The API validates the slug too. This check keeps a bad value out even
		// if a future code path forgets to call the validator.
		check(
			"project_slug_format_check",
			sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
		),
		tenantIsolation(table.organizationId),
	],
).enableRLS();

/**
 * Who can see and work on a project.
 *
 * Two identity columns on purpose:
 *
 * - `member_id` references the Better Auth membership row with ON DELETE
 *   CASCADE. Leaving an organization, being removed from it, deleting the
 *   organization and deleting an account all remove the membership row, so the
 *   project membership disappears with it. No leave flow can be forgotten.
 * - `user_id` is the stable identity used by queries, permissions and display.
 *
 * `organization_id` duplicates the parent organization for the RLS policy. It
 * is always written from the verified tenant scope, never from request input.
 */
export const projectMember = pgTable(
	"project_member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		memberId: text("member_id")
			.notNull()
			.references(() => member.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// owner | admin | member | client, validated by the check below.
		role: text("role").notNull().default("member"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("project_member_project_member_idx").on(
			table.projectId,
			table.memberId,
		),
		index("project_member_organization_idx").on(table.organizationId),
		index("project_member_project_idx").on(table.projectId),
		index("project_member_user_idx").on(table.userId),
		check(
			"project_member_role_check",
			sql`${table.role} in ('owner', 'admin', 'member', 'client')`,
		),
		tenantIsolation(table.organizationId),
	],
).enableRLS();

/**
 * A project the user pinned to the top of their sidebar.
 *
 * Why a table: a pin is per person and per workspace, and it should follow the
 * user across devices, so it cannot live in the browser. One row per pinned
 * project. Unpinning deletes the row.
 *
 * `pinned_at` is a timestamp instead of a boolean so the sidebar can keep a
 * stable order, newest pin first, without a second sort column.
 *
 * The unique index makes pin idempotent: a double click updates the same row.
 */
export const projectPin = pgTable(
	"project_pin",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		pinnedAt: timestamp("pinned_at").defaultNow().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// The conflict target for the idempotent pin upsert.
		uniqueIndex("project_pin_project_user_idx").on(
			table.projectId,
			table.userId,
		),
		// The sidebar reads one person's pins inside one workspace.
		index("project_pin_organization_user_idx").on(
			table.organizationId,
			table.userId,
		),
		tenantIsolation(table.organizationId),
	],
).enableRLS();

/**
 * One agreed piece of work inside a project.
 *
 * Why a milestone table and not a task table: a milestone is the unit a client
 * can reason about ("the homepage is done"), while internal tasks stay in the
 * agency's own tool. The product is about the client facing agreement, so this
 * table is deliberately small.
 *
 * `description` holds the Plate (Slate) value as JSON. `description_text` is a
 * plain text mirror written by the service on every save, so search and list
 * previews never have to walk JSON in SQL. Keeping the mirror also means the
 * search index stays usable if the editor is ever replaced.
 *
 * Dates are Postgres `date`, not timestamps. A milestone is due on a day, not
 * at an instant, so storing a timezone-less day is what stops a due date from
 * drifting one day either side depending on the reader's clock.
 *
 * `status` is open ended in the check on purpose: the five values are the
 * product's vocabulary, while `completed_at` is derived state the service
 * keeps in sync so the database can never hold "done but never completed".
 *
 * `updated_by` exists because anyone on the project may edit a milestone.
 * Without it, "who changed this" has no answer at all.
 */
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
		/** todo | in_progress | blocked | done | cancelled, checked below. */
		status: text("status").notNull().default("todo"),
		/** Both nullable: a milestone can exist before it is scheduled. */
		startDate: date("start_date"),
		dueDate: date("due_date"),
		/** Null means "no estimate". Minutes keep totals exact. */
		estimateMinutes: integer("estimate_minutes"),
		/** Set when the status becomes done, cleared on every other status. */
		completedAt: timestamp("completed_at"),
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
		check(
			"milestone_status_check",
			sql`${table.status} in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')`,
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
 * Cached link previews for one workspace.
 *
 * Why a table and not a live fetch: a hover card must never wait on somebody
 * else's website, and an endpoint that fetches arbitrary URLs on demand is an
 * SSRF proxy. Previews are resolved once by a background worker and read from
 * here afterwards.
 *
 * Why organization scoped: the existence of a URL inside a workspace is
 * business data, so the same URL pasted by two tenants produces two rows. That
 * costs a little duplication and keeps the row level security boundary
 * consistent with every other business table.
 *
 * `url_hash` is a SHA-256 of the canonical URL and is the cache key. The
 * canonical form drops the fragment, lowercases the host and removes the
 * default port, so the same page does not produce two rows.
 *
 * `image_key` and `favicon_key` are storage keys, never remote URLs. The
 * browser only ever loads assets we validated and serve ourselves, which is
 * what prevents tracking pixels and mixed content.
 *
 * `status` is derived from the fetch outcome, not chosen by a client.
 */
export const linkPreview = pgTable(
	"link_preview",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** Canonical URL, the value used for cache keys and safe to re-fetch. */
		url: text("url").notNull(),
		/** SHA-256 of `url`, so a long URL never becomes an index key. */
		urlHash: text("url_hash").notNull(),
		/** pending | ready | unavailable | blocked, checked below. */
		status: text("status").notNull().default("pending"),
		title: text("title"),
		description: text("description"),
		siteName: text("site_name"),
		imageKey: text("image_key"),
		imageWidth: integer("image_width"),
		imageHeight: integer("image_height"),
		faviconKey: text("favicon_key"),
		/** Stable reason code, never the target's own error text. */
		errorCode: text("error_code"),
		fetchedAt: timestamp("fetched_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		// One row per URL per workspace. The worker upserts on this pair.
		uniqueIndex("link_preview_organization_url_idx").on(
			table.organizationId,
			table.urlHash,
		),
		index("link_preview_organization_idx").on(table.organizationId),
		// The refresh job reads the oldest rows of one organization.
		index("link_preview_organization_fetched_idx").on(
			table.organizationId,
			table.fetchedAt,
		),
		check(
			"link_preview_status_check",
			sql`${table.status} in ('pending', 'ready', 'unavailable', 'blocked')`,
		),
		tenantIsolation(table.organizationId),
	],
).enableRLS();
