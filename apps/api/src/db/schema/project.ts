/**
 * Project, membership and pin tables.
 *
 * Why this file: the project row, its members and the per user pin share one
 * lifecycle and one tenant policy. Keeping them together means a project and
 * its membership cannot drift apart.
 *
 * Used by: `db/schema/index.ts` and the project services.
 */

import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { member, organization, user } from "../auth-schema";
import { tenantIsolation } from "../rls";

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
		/**
		 * Substring search for the mention picker.
		 *
		 * `ILIKE '%term%'` cannot use a btree index, so a large workspace would
		 * scan every project on each keystroke. The trigram GIN index keeps the
		 * same contains-style search fast. The extension is created by
		 * `scripts/bootstrap-db.ts` before migrations run.
		 */
		index("project_name_trgm_idx").using(
			"gin",
			sql`${table.name} gin_trgm_ops`,
		),
		/**
		 * Substring search on the Projects page.
		 *
		 * The page matches name OR slug, and `ILIKE '%term%'` on the slug
		 * cannot use the unique btree, so a large workspace would scan every
		 * project on each keystroke. The trigram index mirrors the name one.
		 */
		index("project_slug_trgm_idx").using(
			"gin",
			sql`${table.slug} gin_trgm_ops`,
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
 *
 * `locked_at` and `locked_by` are the manual baseline. They are a separate pair
 * rather than a boolean so the timeline can say who froze the scope and when.
 * `locked_by` is nullable because deleting the actor's account must not fail:
 * the row keeps its lock time and the UI says "an owner".
 */
