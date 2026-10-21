/**
 * Data and mutations for invitations.
 *
 * Why keepPreviousData: paging and filtering should not flash an empty table.
 * While the next page is in flight the previous rows stay visible, which is the
 * standard server pagination feel.
 *
 * Used by: the invitations page, the invite dialog and the public accept page.
 */

import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

import { ApiRequestError } from "#/lib/api";
import { invalidateOrganizationQueries } from "#/lib/organization-queries";
import {
	bulkCancelInvitations,
	bulkInvite,
	bulkResendInvitations,
	fetchInvitationPreview,
	fetchInvitations,
	type InvitationHistoryQuery,
	requestInvitationMagicLink,
} from "./api";

/** One workspace's invitation history page. */
export function useInvitations(orgSlug: string, query: InvitationHistoryQuery) {
	return useQuery({
		queryKey: [
			"organization",
			orgSlug,
			"invitations",
			query.status,
			query.role,
			query.search,
			query.page,
			query.pageSize,
			query.sort,
			query.direction,
		],
		queryFn: () => fetchInvitations(orgSlug, query),
		placeholderData: keepPreviousData,
		staleTime: 15_000,
		// A 403 is the access wall, not a transient failure. Retrying it only
		// delays the access card.
		retry: (failureCount, error) => {
			if (
				error instanceof ApiRequestError &&
				(error.status === 403 || error.status === 404)
			) {
				return false;
			}

			return failureCount < 2;
		},
	});
}

/**
 * Public invitation preview.
 *
 * The viewer key is part of the query key so signing in or out refetches the
 * preview and its `viewer.emailMatches` flags. Without it the page would keep
 * showing the signed out state after a magic link returns.
 */
export function useInvitationPreview(invitationId: string, viewerKey: string) {
	return useQuery({
		queryKey: ["invitation-preview", invitationId, viewerKey],
		queryFn: () => fetchInvitationPreview(invitationId),
		// A missing or expired invitation is a normal page state, not a
		// transient failure worth three retries.
		retry: false,
	});
}

/** Invite one or more addresses. Per address results are in the response. */
export function useBulkInvite(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			emails,
			role,
		}: {
			emails: string[];
			role: "member" | "admin";
		}) => bulkInvite(orgSlug, emails, role),
		onSuccess: async () => {
			await invalidateOrganizationQueries(queryClient, orgSlug);
		},
	});
}

/** Resend selected invitations. */
export function useBulkResendInvitations(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (invitationIds: string[]) =>
			bulkResendInvitations(orgSlug, invitationIds),
		onSuccess: async () => {
			await invalidateOrganizationQueries(queryClient, orgSlug);
		},
	});
}

/** Cancel selected invitations. */
export function useBulkCancelInvitations(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (invitationIds: string[]) =>
			bulkCancelInvitations(orgSlug, invitationIds),
		onSuccess: async () => {
			await invalidateOrganizationQueries(queryClient, orgSlug);
		},
	});
}

/** Request a magic link for an invitation's own address. */
export function useInvitationMagicLink(invitationId: string) {
	return useMutation({
		mutationFn: () => requestInvitationMagicLink(invitationId),
	});
}
