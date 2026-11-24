/**
 * Shared RLS verification state and assertions.
 *
 * Why this file: every check reports through the same result list and uses the
 * same seeded ids and error helpers. Keeping that state in one module means the
 * groups cannot drift.
 *
 * Used by: `fixtures.ts`, the check groups and the entry script.
 */



/** Postgres SQLSTATE for permission denied and RLS violations. */
export const INSUFFICIENT_PRIVILEGE = "42501";
export const APP_ROLE = "app_tenant";

export type CheckResult = {
	name: string;
	passed: boolean;
	detail: string;
};

export const results: CheckResult[] = [];
export const suffix = Date.now().toString(36);

export const orgA = `rls-org-a-${suffix}`;
export const orgB = `rls-org-b-${suffix}`;
export const userA = `rls-user-a-${suffix}`;
export const userB = `rls-user-b-${suffix}`;
export const memberA = `rls-member-a-${suffix}`;
export const memberB = `rls-member-b-${suffix}`;
export const projectA = `rls-project-a-${suffix}`;
export const projectB = `rls-project-b-${suffix}`;
export const milestoneA = `rls-milestone-a-${suffix}`;
export const milestoneB = `rls-milestone-b-${suffix}`;
export const commentA = `rls-comment-a-${suffix}`;
export const changeRequestA = `rls-change-request-a-${suffix}`;
export const statusPeriodA = `rls-status-period-a-${suffix}`;
export const scopeEntryA = `rls-scope-entry-a-${suffix}`;
export const linkPreviewA = `rls-link-preview-a-${suffix}`;

export const scopeA = { organizationId: orgA, userId: userA };

export function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function pgErrorCode(error: unknown): string | undefined {
	// Drizzle wraps driver failures in a DrizzleQueryError, so the Postgres
	// SQLSTATE sits on the cause chain rather than on the top level error.
	let current: unknown = error;

	for (let depth = 0; depth < 5; depth += 1) {
		if (typeof current !== "object" || current === null) return undefined;

		const code = (current as { code?: unknown }).code;
		if (typeof code === "string") return code;

		current = (current as { cause?: unknown }).cause;
	}

	return undefined;
}

export function record(name: string, passed: boolean, detail: string): void {
	results.push({ name, passed, detail });
	process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${name}: ${detail}\n`);
}

/** Run a check that must succeed. */
export async function check(name: string, fn: () => Promise<string>): Promise<void> {
	try {
		record(name, true, await fn());
	} catch (error) {
		record(name, false, describeError(error));
	}
}

/** Run an operation that must be rejected by Postgres. */
export async function expectFailure(
	name: string,
	expectedCode: string,
	fn: () => Promise<unknown>,
): Promise<void> {
	try {
		await fn();
		record(name, false, `expected SQLSTATE ${expectedCode}, query succeeded`);
	} catch (error) {
		const code = pgErrorCode(error);
		if (code === expectedCode) {
			record(name, true, `rejected with SQLSTATE ${code}`);
			return;
		}
		record(
			name,
			false,
			`expected SQLSTATE ${expectedCode}, got ${code ?? describeError(error)}`,
		);
	}
}
