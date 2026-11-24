/**
 * Link preview table.
 *
 * Why this file: link metadata is cached per organization and is not part of
 * any milestone or comment row. Keeping it separate makes the cache boundary
 * clear.
 *
 * Used by: `db/schema/index.ts` and the link preview service.
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
import { organization } from "../auth-schema";
import { tenantIsolation } from "../rls";

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
		/** Sanitised provider details returned by a public adapter or oEmbed. */
		providerData: jsonb("provider_data").$type<{
			provider: string;
			kind: string;
			fields: { label: string; value: string }[];
		} | null>(),
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

/**
 * One entry in a person's bell.
 *
 * Why a row per recipient instead of one event with read state: a notification
 * is addressed to a specific person. A comment that mentions two people is two
 * rows, so one person's read state can never affect the other's, and the list
 * stays a plain indexed read.
 *
 * Why the subject columns are typed foreign keys instead of a polymorphic
 * `subject_type` and `subject_id`: the same reason `comment` uses typed target
 * columns. Cascade cleanup belongs to the database. Deleting a milestone, a
 * project, a comment or a change request removes the notifications that point
 * at it even on a cascade path no service code runs through.
 *
 * `dedupe_key` is unique per recipient. It makes a retried request, a repeated
 * autosave and a fan-out race idempotent instead of producing two bells. Where
 * a transition is already idempotent in its service, a random key is used and
 * the index simply never conflicts.
 *
 * `data` carries only small enum-like extras. Project names, milestone titles
 * and previews are read from the joined source row, so a rename is reflected
 * immediately and a deleted source cannot leave stale copy behind.
 */
