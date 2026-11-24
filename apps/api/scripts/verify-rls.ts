/**
 * Row level security checks against the real business tables.
 *
 * Why: RLS is invisible when it works and catastrophic when it silently does
 * not (for example if the tenant client ever fell back to the superuser). The
 * earlier version of this script used a throwaway probe table because no
 * business table existed. Now it exercises `project` and `project_member`
 * directly, including the cascade that removes project data with an
 * organization.
 *
 * The script seeds its own organization, user, member and project rows on the
 * privileged client, proves the tenant boundary, then removes everything it
 * created. Run against a development database only.
 *
 * Requires: `bun run db:bootstrap` and `bun run db:migrate`.
 * Used by: `bun run db:verify-rls`.
 */

import { adminClient } from "../src/db";
import { closeTenantDb } from "../src/db/tenant";

import { cleanup, seed, assertRoleExists } from "./verify-rls/fixtures";
import { checkDomainBoundary } from "./verify-rls/domain";
import { checkCoreBoundary } from "./verify-rls/core";
import { checkMiscBoundary } from "./verify-rls/misc";
import { checkPersonalBoundary } from "./verify-rls/personal";
import { results } from "./verify-rls/shared";

async function main(): Promise<void> {
	await assertRoleExists();
	await seed();

	try {
		await checkCoreBoundary();
		await checkDomainBoundary();
		await checkPersonalBoundary();
		await checkMiscBoundary();
	} finally {
		await cleanup();
		await closeTenantDb();
		await adminClient.end({ timeout: 5 });
	}

	const failed = results.filter((result) => !result.passed);
	process.stdout.write(
		`\n${results.length - failed.length}/${results.length} checks passed\n`,
	);

	if (failed.length > 0) {
		process.exitCode = 1;
	}
}

await main();
