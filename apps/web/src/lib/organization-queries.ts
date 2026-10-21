import type { QueryClient } from "@tanstack/react-query";

/**
 * The query key prefix every organization page shares.
 *
 * Why: a member change refreshes the members table, the invitation counts and
 * the settings owner count. Each mutation invalidates this prefix once instead
 * of listing every page's key and drifting when a page is added.
 *
 * Used by: features/members/hooks.ts and features/invitations/hooks.ts.
 */
export function organizationQueryKey(orgSlug: string) {
	return ["organization", orgSlug] as const;
}

/** Invalidate every query that belongs to one workspace. */
export function invalidateOrganizationQueries(
	queryClient: QueryClient,
	orgSlug: string,
): Promise<void> {
	return queryClient.invalidateQueries({
		queryKey: organizationQueryKey(orgSlug),
	});
}
