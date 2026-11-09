/**
 * Business tables the tenant role may touch.
 *
 * Why this lives in its own module: `bootstrap-db.ts` cannot be imported
 * (it runs `main()` at module load), and `verify-rls.ts` needs the same
 * list to check that every listed table has an RLS policy and vice versa.
 *
 * Deliberately an allowlist rather than ALTER DEFAULT PRIVILEGES. A new table
 * that is not listed here fails loudly with "permission denied", which is much
 * safer than quietly granting access to a table that has no RLS policy.
 *
 * Better Auth tables are intentionally absent. `user`, `session`, `account`,
 * `verification`, `organization`, `member` and `invitation` belong to the auth
 * library and are only touched through its API on the privileged client.
 *
 * Add each new business table (with an RLS policy) to this list.
 *
 * Used by: scripts/bootstrap-db.ts, scripts/verify-rls.ts.
 */
export const TENANT_TABLES: readonly string[] = [
	"project",
	"project_member",
	"project_pin",
	"milestone",
	"milestone_assignee",
	"comment",
	"link_preview",
];
