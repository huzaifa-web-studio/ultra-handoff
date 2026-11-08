/**
 * Stale unverified account cleanup.
 *
 * Why: a password sign-up creates a usable-looking row before the address is
 * confirmed. If the person never opens the verification email, that row keeps
 * the address reserved forever and blocks the real owner from signing up with
 * password or with Google or GitHub. Seven days is long enough for a genuine
 * person to finish verification and short enough that an abandoned or mistyped
 * address stops blocking anyone.
 *
 * The rules are kept here, free of database and auth imports, so the deletion
 * decision can be tested without a connection. The queue wires the real
 * adapters in src/queues/account-cleanup.ts.
 *
 * Used by: src/queues/account-cleanup.ts.
 */

/** A row older than this with an unconfirmed address is removed. */
export const UNVERIFIED_ACCOUNT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Rows fetched per page while collecting candidates. */
const PAGE_SIZE = 100;

/**
 * Cap one sweep so a large backlog cannot hold the worker for minutes. The
 * next hourly sweep continues where this one stopped.
 */
const MAX_ROWS_PER_SWEEP = 1000;

export type StaleAccountCleanupDeps = {
	/**
	 * Unverified users created before `cutoff`, oldest first.
	 *
	 * The implementation must filter, not the caller, so a stale backlog never
	 * travels through memory.
	 */
	listStaleUsers: (
		cutoff: Date,
		limit: number,
		offset: number,
	) => Promise<{ id: string }[]>;
	/** User ids that belong to a workspace and must never be removed. */
	findMemberUserIds: (userIds: string[]) => Promise<Set<string>>;
	/** Remove one user and the auth rows attached to it. */
	deleteUser: (userId: string) => Promise<void>;
};

/** The moment a row stops being "still being verified" and becomes stale. */
export function staleAccountCutoff(now: Date): Date {
	return new Date(now.getTime() - UNVERIFIED_ACCOUNT_TTL_MS);
}

/**
 * Remove unverified users older than the TTL and return how many were removed.
 *
 * Membership is checked in one query up front. An unverified user should not
 * belong to a workspace, because nothing can create a session before the
 * address is confirmed, but the guard keeps a data repair or a future flow
 * from turning cleanup into workspace damage.
 */
export async function removeStaleUnverifiedAccounts(
	deps: StaleAccountCleanupDeps,
	now = new Date(),
): Promise<number> {
	const cutoff = staleAccountCutoff(now);
	const candidates: { id: string }[] = [];

	for (let offset = 0; offset < MAX_ROWS_PER_SWEEP; offset += PAGE_SIZE) {
		const page = await deps.listStaleUsers(cutoff, PAGE_SIZE, offset);
		candidates.push(...page);

		if (page.length < PAGE_SIZE) break;
	}

	if (candidates.length === 0) return 0;

	const memberIds = await deps.findMemberUserIds(
		candidates.map((row) => row.id),
	);
	let removed = 0;

	for (const candidate of candidates) {
		if (memberIds.has(candidate.id)) continue;

		await deps.deleteUser(candidate.id);
		removed += 1;
	}

	return removed;
}
