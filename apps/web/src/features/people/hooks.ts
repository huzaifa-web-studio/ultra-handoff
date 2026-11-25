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

import { ApiRequestError } from "#/lib/api";
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
		/**
		 * Do not retry a client error.
		 *
		 * A 404 means the person is no longer in the workspace, and a 401 or 403
		 * will not fix itself. Retrying those kept the hover card on its loading
		 * skeleton for about seven seconds and sent four pointless requests.
		 * A server error still gets two retries, which covers a transient
		 * database or network blip.
		 */
		retry: (failureCount, error) => {
			if (
				error instanceof ApiRequestError &&
				error.status >= 400 &&
				error.status < 500
			) {
				return false;
			}

			return failureCount < 2;
		},
	});
}
