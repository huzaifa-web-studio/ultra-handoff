/**
 * Member profile queries.
 *
 * Why one key for the hover card and the page: hovering an avatar already
 * fetched the profile, so opening the page must not fetch it again. The key
 * lives under the workspace prefix, which every role and membership mutation
 * invalidates, so a promotion or removal updates both surfaces together.
 *
 * Used by: features/people/profile-page.tsx and
 * components/member-hover-card.tsx.
 */

import { useQuery } from "@tanstack/react-query";

import { fetchMemberProfile } from "./api";

/** Query key shared by every surface that renders one member's profile. */
export function memberProfileKey(orgSlug: string, userId: string) {
	return ["organization", orgSlug, "people", userId] as const;
}

/**
 * Read one profile.
 *
 * `enabled` lets the hover card stay dormant until it opens. The page leaves it
 * true so the profile loads immediately.
 */
export function useMemberProfile(
	orgSlug: string,
	userId: string,
	enabled = true,
) {
	return useQuery({
		queryKey: memberProfileKey(orgSlug, userId),
		queryFn: () => fetchMemberProfile(orgSlug, userId),
		enabled: enabled && orgSlug.length > 0 && userId.length > 0,
		// A profile changes rarely. A minute keeps role or project changes from
		// feeling stale without refetching on every hover.
		staleTime: 60_000,
	});
}
