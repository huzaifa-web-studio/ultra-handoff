/**
 * Push subscription table.
 *
 * Why this file: a push subscription is a personal device token with its own
 * user scoped policy. Keeping it apart from the notification rows makes that
 * lower trust explicit.
 *
 * Used by: `db/schema/index.ts` and the push service.
 */

import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "../auth-schema";
import { pushSubscriptionClaim, userIsolation } from "../rls";

export const pushSubscription = pgTable(
	"push_subscription",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** The push service URL. Treated as a secret and never logged. */
		endpoint: text("endpoint").notNull(),
		p256dh: text("p256dh").notNull(),
		auth: text("auth").notNull(),
		userAgent: text("user_agent"),
		failureCount: integer("failure_count").notNull().default(0),
		lastUsedAt: timestamp("last_used_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("push_subscription_endpoint_idx").on(table.endpoint),
		index("push_subscription_user_idx").on(table.userId),
		userIsolation(table.userId),
		pushSubscriptionClaim({
			endpointColumn: table.endpoint,
			userColumn: table.userId,
		}),
	],
).enableRLS();
