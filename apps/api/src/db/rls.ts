/**
 * Row level security helpers for business tables.
 *
 * Scope: business data only. Better Auth owns `user`, `session`, `account`,
 * `verification`, `organization`, `member` and `invitation`. Those tables are
 * internal to the auth library, which reads across organizations (list my
 * organizations, accept an invitation, setActive), so they stay on the
 * privileged client and carry no policies. Nothing about them belongs here.
 *
 * Business tables (`project`, `client`, `deliverable`, ...) each carry
 * `organization_id` and use `tenantIsolation(...)`, so the rule lives in one
 * place instead of being copy-pasted per table.
 *
 * Used by: business tables in src/db/.
 */

import { sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { pgPolicy, pgRole } from "drizzle-orm/pg-core";

/**
 * Unprivileged role that business queries run as.
 *
 * The `app` role is a superuser and owns these tables, so Postgres always
 * bypasses RLS for it (even with FORCE ROW LEVEL SECURITY). The policy below
 * is only meaningful for a role that is neither superuser nor table owner,
 * which is exactly what `app_tenant` is.
 *
 * `.existing()` tells drizzle-kit the role is created by
 * scripts/bootstrap-db.ts, so it must never emit CREATE ROLE itself (the
 * password comes from the environment, not from a committed migration).
 */
export const appRole = pgRole("app_tenant").existing();

/**
 * Build the standard tenant isolation policy for a column.
 *
 * `current_setting('app.current_org_id', true)` returns NULL when the setting
 * is missing, so the comparison is NULL and Postgres filters the row out.
 * That is intentional: forgetting the tenant scope returns zero rows instead
 * of every row.
 */
export function tenantIsolation(column: PgColumn) {
	return pgPolicy("tenant_isolation", {
		as: "permissive",
		for: "all",
		to: appRole,
		using: sql`${column} = current_setting('app.current_org_id', true)`,
		withCheck: sql`${column} = current_setting('app.current_org_id', true)`,
	});
}

/**
 * Personal isolation for a table that belongs to one user, not one workspace.
 *
 * Used by push subscriptions, which are device tokens rather than business
 * data. The same browser should not need one subscription per workspace, so
 * the row carries only `user_id` and this policy compares only the user
 * setting.
 */
export function userIsolation(column: PgColumn) {
	return pgPolicy("user_isolation", {
		as: "permissive",
		for: "all",
		to: appRole,
		using: sql`${column} = current_setting('app.current_user_id', true)`,
		withCheck: sql`${column} = current_setting('app.current_user_id', true)`,
	});
}

/**
 * Let a signed in browser claim an endpoint that still belongs to a previous
 * account on the same device.
 *
 * Why this exists: push endpoints are globally unique. Signing out removes the
 * row, but a closed browser can leave one behind. Without a claim path, the
 * next person on that device could never subscribe the same browser, because
 * the user-only UPDATE policy would hide the previous person's row.
 *
 * The claim is scoped by the endpoint supplied to `withUser`, and the new row
 * still has to pass the user isolation WITH CHECK. A person can therefore only
 * reassign an endpoint their own browser already holds.
 */
export function pushSubscriptionClaim({
	endpointColumn,
	userColumn,
}: {
	endpointColumn: PgColumn;
	userColumn: PgColumn;
}) {
	const sameEndpoint = sql`${endpointColumn} = current_setting('app.push_endpoint', true)`;
	const sameUser = sql`${userColumn} = current_setting('app.current_user_id', true)`;

	return [
		// The row must be visible to the claim update, because the UPDATE has to
		// locate the endpoint that still belongs to the previous account.
		pgPolicy("push_subscription_claim_select", {
			as: "permissive",
			for: "select",
			to: appRole,
			using: sameEndpoint,
		}),
		pgPolicy("push_subscription_claim_update", {
			as: "permissive",
			for: "update",
			to: appRole,
			using: sameEndpoint,
			withCheck: sameUser,
		}),
		pgPolicy("push_subscription_claim_delete", {
			as: "permissive",
			for: "delete",
			to: appRole,
			using: sameEndpoint,
		}),
	];
}

/** The two columns a notification uses to decide who may see it. */
type NotificationColumns = {
	organizationColumn: PgColumn;
	recipientColumn: PgColumn;
};

/**
 * Notification policies.
 *
 * Why four policies instead of one: creating a notification is cross-user by
 * nature. The author of a comment is user A, while the row belongs to user B.
 * A single self-scoped policy would reject that insert. These rules keep the
 * write boundary at the workspace and the read boundary at the person:
 *
 *   - SELECT, UPDATE, DELETE: the row must belong to the current workspace and
 *     the current user. A member can never read or clear somebody else's bell.
 *   - INSERT: any row in the current workspace. The service resolves recipients
 *     from project membership, so it cannot invent a recipient from request
 *     input.
 *
 * Postgres ORs permissive policies for the same command, so there is exactly
 * one policy per command here. Adding a broader `tenantIsolation` on the same
 * table would silently widen the SELECT rule.
 */
export function notificationPolicies({
	organizationColumn,
	recipientColumn,
}: NotificationColumns) {
	const selfScope = sql`${organizationColumn} = current_setting('app.current_org_id', true) and ${recipientColumn} = current_setting('app.current_user_id', true)`;

	return [
		pgPolicy("notification_select", {
			as: "permissive",
			for: "select",
			to: appRole,
			using: selfScope,
		}),
		pgPolicy("notification_insert", {
			as: "permissive",
			for: "insert",
			to: appRole,
			withCheck: sql`${organizationColumn} = current_setting('app.current_org_id', true)`,
		}),
		pgPolicy("notification_update", {
			as: "permissive",
			for: "update",
			to: appRole,
			using: selfScope,
			withCheck: selfScope,
		}),
		pgPolicy("notification_delete", {
			as: "permissive",
			for: "delete",
			to: appRole,
			using: selfScope,
		}),
		/**
		 * A person may delete a notification their own action created.
		 *
		 * Used when an edit removes a mention or a comment is deleted. The
		 * author cannot read the row, only remove it, which is exactly the
		 * cleanup permission needed and nothing more.
		 */
		pgPolicy("notification_actor_delete", {
			as: "permissive",
			for: "delete",
			to: appRole,
			using: sql`${organizationColumn} = current_setting('app.current_org_id', true) and actor_user_id = current_setting('app.current_user_id', true)`,
		}),
	];
}
