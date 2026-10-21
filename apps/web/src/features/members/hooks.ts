/**
 * Data and mutations for the Members page.
 *
 * Why react-query: the page is shared by several dialogs and needs one source
 * of truth for the member list. A mutation invalidates the whole organization
 * prefix, so the invitation counts in the members summary and on the
 * Invitations page refresh together.
 *
 * Used by: routes/_app/$orgSlug.settings.members.tsx and the member dialogs.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { invalidateOrganizationQueries } from "#/lib/organization-queries";
import {
	bulkRemoveMembers,
	bulkUpdateMemberRole,
	fetchMembers,
	updateMemberRole,
} from "./api";

/** Query key for one workspace's member payload. */
function membersKey(orgSlug: string) {
	return ["organization", orgSlug, "members"] as const;
}

export function useMembers(orgSlug: string, enabled = true) {
	return useQuery({
		queryKey: membersKey(orgSlug),
		queryFn: () => fetchMembers(orgSlug),
		enabled,
		// Short stale window keeps a second tab's role change visible without
		// hammering the API on every focus.
		staleTime: 15_000,
	});
}

/** Change one member's role, including promotion to owner. */
export function useUpdateMemberRole(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			memberId,
			role,
		}: {
			memberId: string;
			role: "member" | "admin" | "owner";
		}) => updateMemberRole(orgSlug, memberId, role),
		onSuccess: async (data) => {
			await invalidateOrganizationQueries(queryClient, orgSlug);
			toast.success(`Role updated to ${data.role}.`);
		},
	});
}

/** Change several roles at once. Owner is excluded by design. */
export function useBulkUpdateMemberRole(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			memberIds,
			role,
		}: {
			memberIds: string[];
			role: "member" | "admin";
		}) => bulkUpdateMemberRole(orgSlug, memberIds, role),
		onSuccess: async () => {
			await invalidateOrganizationQueries(queryClient, orgSlug);
		},
	});
}

/** Remove one or several members, with per item outcomes. */
export function useBulkRemoveMembers(orgSlug: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (memberIds: string[]) => bulkRemoveMembers(orgSlug, memberIds),
		onSuccess: async () => {
			await invalidateOrganizationQueries(queryClient, orgSlug);
		},
	});
}
