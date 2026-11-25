/**
 * Typed Eden calls for a member profile.
 *
 * Why a feature API module: the hover card and the profile page read the same
 * endpoint, so the request shape, the error conversion and the response type
 * live here once. Both surfaces share one query key, which is what makes a
 * hover followed by a click render from cache.
 *
 * Used by: features/people/hooks.ts.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";

/** One person's profile, as the API allows the viewer to see it. */
export async function fetchMemberProfile(orgSlug: string, userId: string) {
	const response = await api.orgs({ orgSlug }).people({ userId }).get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load that profile."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load that profile.", 0);
	}

	return response.data;
}

export type MemberProfile = Awaited<ReturnType<typeof fetchMemberProfile>>;
export type MemberProfileProject = MemberProfile["projects"][number];
export type MemberProfileAssignment = MemberProfile["assignments"][number];
