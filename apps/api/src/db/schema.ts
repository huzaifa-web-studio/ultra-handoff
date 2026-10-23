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
	check,
	index,
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
