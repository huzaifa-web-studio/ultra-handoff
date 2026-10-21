/**
 * Typed Eden calls for the Members page.
 *
 * Why a feature API module: the page never calls `api` directly, so the
 * request shape and the error conversion live in one place. Return types are
 * derived from the call, which keeps the table columns in sync with the API
 * without a shared types package.
 *
 * Used by: features/members/hooks.ts.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";

/** Every member and capability the page needs, in one request. */
export async function fetchMembers(orgSlug: string) {
	const response = await api.orgs({ orgSlug }).members.get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the members."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the members.", 0);
	}

	return response.data;
}

export type MembersResponse = Awaited<ReturnType<typeof fetchMembers>>;
export type MemberRow = MembersResponse["members"][number];
export type MemberViewer = MembersResponse["viewer"];

/** One role change, including promotion to owner. */
export async function updateMemberRole(
	orgSlug: string,
	memberId: string,
	role: "member" | "admin" | "owner",
): Promise<{ id: string; role: string }> {
	const response = await api
		.orgs({ orgSlug })
		.members({ memberId })
		.patch({ role });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not change that role."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not change that role.", 0);
	}

	return response.data;
}

/** Bulk role change. Owner is never sent from this path. */
export async function bulkUpdateMemberRole(
	orgSlug: string,
	memberIds: string[],
	role: "member" | "admin",
) {
	const response = await api
		.orgs({ orgSlug })
		.members["bulk-role"].post({ memberIds, role });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not change those roles."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not change those roles.", 0);
	}

	return response.data;
}

/** Bulk removal with per item outcomes. */
export async function bulkRemoveMembers(orgSlug: string, memberIds: string[]) {
	const response = await api
		.orgs({ orgSlug })
		.members["bulk-remove"].post({ memberIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not remove those members."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not remove those members.", 0);
	}

	return response.data;
}

/** One outcome in a bulk response. */
export type BulkItemResult = Awaited<
	ReturnType<typeof bulkRemoveMembers>
>["results"][number];
