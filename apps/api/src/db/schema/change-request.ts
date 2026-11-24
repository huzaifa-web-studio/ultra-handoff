/**
 * Change request and scope section tables.
 *
 * Why this file: accepting a change request creates a named scope section in
 * the same flow. Keeping the two tables together makes that link explicit.
 *
 * Used by: `db/schema/index.ts` and the change request services.
 */

import { sql } from "drizzle-orm";
import {
	check,
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
import { milestone, milestoneStatusPeriod } from "./milestone";
import { project } from "./project";

export const changeRequest = pgTable(
	"change_request",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		projectId: text("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		/** The milestone the request was raised against. */
		milestoneId: text("milestone_id")
			.notNull()
			.references(() => milestone.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		/** Plate value. Always an array; the service validates before writing. */
		body: jsonb("body").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
		/** Plain text mirror used by previews and search. */
		bodyText: text("body_text").notNull().default(""),
		/** open | accepted | declined | moved | withdrawn, checked below. */
		status: text("status").notNull().default("open"),
		requestedBy: text("requested_by").references(() => user.id, {
			onDelete: "set null",
		}),
		decidedBy: text("decided_by").references(() => user.id, {
			onDelete: "set null",
		}),
		decidedAt: timestamp("decided_at"),
		/** Short plain text excerpt of the decision, never rich text. */
		decisionNote: text("decision_note"),
		/** Set when the request is turned into a new milestone. */
		targetMilestoneId: text("target_milestone_id").references(
			() => milestone.id,
			{ onDelete: "set null" },
		),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("change_request_organization_idx").on(table.organizationId),
		// The one list the Changes tab reads, and the open count per milestone.
		index("change_request_project_milestone_status_idx").on(
			table.projectId,
			table.milestoneId,
			table.status,
		),
		// Supports the "this request became that milestone" link and its cleanup.
		index("change_request_target_milestone_idx").on(table.targetMilestoneId),
		check(
			"change_request_status_check",
			sql`${table.status} in ('open', 'accepted', 'declined', 'moved', 'withdrawn')`,
		),
		tenantIsolation(table.organizationId),
	],
).enableRLS();

/**
 * One named addition to a milestone scope.
 *
 * Why a table instead of appending rich text into `milestone.description`: the
 * initial scope is the agreed baseline and stays exactly as written. An
 * addition has its own author, date, kind and source, so a reader can always
 * tell what was originally agreed from what was accepted, tested or reviewed
 * later. It also keeps the accepted text immutable even when the underlying
 * change request is history.
 *
 * Kinds:
 *   - `change` is created when a change request is accepted, and carries the
 *     final accepted text (which may be trimmed, so partial acceptance works).
 *   - `test` is created when a milestone enters `in_testing`, and is writable
 *     only during that exact status period.
 *   - `review` is created when a milestone enters `in_review`, and is writable
 *     by any project member during that exact status period.
 *
 * `round` numbers the test and review visits ("Test round 2"). It is null for
 * change entries, which are named by the accepted request instead.
 *
 * `status_period_id` ties a phase round to the exact visit that created it, so
 * an old round cannot become writable again just because the status name came
 * back. A partial unique index allows one round per period.
 *
 * `change_request_id` is kept for the link back to the request. It uses
 * `set null` so deleting the request record never deletes the scope the project
 * agreed to.
 */
export const milestoneScopeEntry = pgTable(
	"milestone_scope_entry",
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
		/** change | test | review, checked below. */
		kind: text("kind").notNull(),
		/** Null for change entries, which are named by the request title. */
		round: integer("round"),
		title: text("title").notNull(),
		body: jsonb("body").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
		bodyText: text("body_text").notNull().default(""),
		changeRequestId: text("change_request_id").references(
			() => changeRequest.id,
			{ onDelete: "set null" },
		),
		statusPeriodId: text("status_period_id").references(
			() => milestoneStatusPeriod.id,
			{ onDelete: "set null" },
		),
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
		// The Scope tab read: every section of one milestone in order.
		index("milestone_scope_entry_milestone_idx").on(
			table.milestoneId,
			table.createdAt,
			table.id,
		),
		index("milestone_scope_entry_organization_idx").on(table.organizationId),
		// Supports the "this request became that scope section" link.
		index("milestone_scope_entry_change_request_idx").on(table.changeRequestId),
		// One round per phase visit, and no two rounds with the same number.
		uniqueIndex("milestone_scope_entry_period_idx")
			.on(table.statusPeriodId)
			.where(sql`${table.statusPeriodId} is not null`),
		uniqueIndex("milestone_scope_entry_round_idx")
			.on(table.milestoneId, table.kind, table.round)
			.where(sql`${table.round} is not null`),
		check(
			"milestone_scope_entry_kind_check",
			sql`${table.kind} in ('change', 'test', 'review')`,
		),
		check(
			"milestone_scope_entry_round_check",
			sql`(${table.kind} = 'change' and ${table.round} is null) or (${table.kind} in ('test', 'review') and ${table.round} is not null and ${table.round} > 0)`,
		),
		check(
			"milestone_scope_entry_period_check",
			sql`(${table.kind} = 'change' and ${table.statusPeriodId} is null) or (${table.kind} in ('test', 'review') and ${table.statusPeriodId} is not null)`,
		),
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
