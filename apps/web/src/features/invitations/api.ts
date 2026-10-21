/**
 * Typed Eden calls for invitations.
 *
 * Why a separate module from members: invitations are manager only and the
 * history page paginates on the server, so the request shape differs enough to
 * own its file. The public accept page also lives here, so one module owns
 * every invitation request.
 *
 * Used by: features/invitations/hooks.ts and the invite accept page.
 */

import {
	ApiRequestError,
	api,
	readApiError,
	readApiErrorStatus,
} from "#/lib/api";

export type InvitationStatus =
	| "pending"
	| "expired"
	| "accepted"
	| "canceled"
	| "rejected";

/** The role an invitation grants, for the history filter. */
export type InvitationRoleFilter = "all" | "owner" | "admin" | "member";

export type InvitationHistoryQuery = {
	status: "all" | InvitationStatus;
	role: InvitationRoleFilter;
	search: string;
	page: number;
	pageSize: number;
	sort: "createdAt" | "expiresAt" | "email" | "status";
	direction: "asc" | "desc";
};

/** One page of invitation history plus full set counts. */
export async function fetchInvitations(
	orgSlug: string,
	query: InvitationHistoryQuery,
) {
	const response = await api.orgs({ orgSlug }).invitations.get({
		query: {
			status: query.status,
			role: query.role,
			search: query.search,
			page: String(query.page),
			pageSize: String(query.pageSize),
			sort: query.sort,
			direction: query.direction,
		},
	});

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load the invitations."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load the invitations.", 0);
	}

	return response.data;
}

export type InvitationsResponse = Awaited<ReturnType<typeof fetchInvitations>>;
export type InvitationRow = InvitationsResponse["items"][number];
export type InvitationCounts = InvitationsResponse["counts"];

/** Invite several addresses. Per address outcomes come back in one response. */
export async function bulkInvite(
	orgSlug: string,
	emails: string[],
	role: "member" | "admin",
) {
	const response = await api
		.orgs({ orgSlug })
		.invitations.bulk.post({ emails, role });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not send the invitations."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not send the invitations.", 0);
	}

	return response.data;
}

/** Resend selected invitations, refreshing their expiry. */
export async function bulkResendInvitations(
	orgSlug: string,
	invitationIds: string[],
) {
	const response = await api
		.orgs({ orgSlug })
		.invitations["bulk-resend"].post({ invitationIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not resend the invitations."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not resend the invitations.", 0);
	}

	return response.data;
}

/** Cancel selected pending or expired invitations. */
export async function bulkCancelInvitations(
	orgSlug: string,
	invitationIds: string[],
) {
	const response = await api
		.orgs({ orgSlug })
		.invitations["bulk-cancel"].post({ invitationIds });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not cancel the invitations."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not cancel the invitations.", 0);
	}

	return response.data;
}

/** Public preview used by the accept page before sign in. */
export async function fetchInvitationPreview(invitationId: string) {
	const response = await api.invitations({ invitationId }).get();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load this invitation."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	if (!response.data) {
		throw new ApiRequestError("Could not load this invitation.", 0);
	}

	return response.data;
}

export type InvitationPreview = Awaited<
	ReturnType<typeof fetchInvitationPreview>
>;

/** Ask the API to email a one-time sign in link to the invited address. */
export async function requestInvitationMagicLink(invitationId: string) {
	const response = await api.invitations({ invitationId })["magic-link"].post();

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not send a sign-in link."),
			readApiErrorStatus(response.error) ?? 0,
		);
	}

	return { status: "sent" as const };
}

/** Shared result item type for every bulk invitation action. */
export type InvitationBulkResult = Awaited<
	ReturnType<typeof bulkInvite>
>["results"][number];
