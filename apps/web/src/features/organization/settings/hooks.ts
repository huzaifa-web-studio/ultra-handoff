/**
 * Data and mutations for the organization General settings page.
 *
 * Why react-query for the owner count: the leave card has to know whether the
 * current owner is the only owner before it shows a button that would fail.
 * The member list comes from Better Auth, and the same query will be reused by
 * the Members page later.
 *
 * Used by: general-card.tsx, leave-card.tsx and route settings page.
 */

import { useMutation, useQuery } from "@tanstack/react-query";

import { authClient } from "#/features/auth/client";
import { api, readApiError } from "#/lib/api";
import { roleParts } from "../permissions";

/**
 * Force the client side active organization to refetch.
 *
 * Name and slug updates already invalidate the atom through Better Auth, but a
 * logo update happens inside the API, so the browser has to ask for the new
 * row explicitly.
 */
export async function refreshActiveOrganization(
	organizationId: string,
): Promise<void> {
	const { error } = await authClient.organization.setActive({ organizationId });

	if (error) {
		throw new Error(
			error.message ?? "Could not refresh the organization details.",
		);
	}
}

type UpdateOrganizationInput = {
	organizationId: string;
	name: string;
	slug: string;
};

/** Save the editable organization profile fields. */
export function useUpdateOrganization() {
	return useMutation({
		mutationFn: async (input: UpdateOrganizationInput) => {
			const { data, error } = await authClient.organization.update({
				data: { name: input.name, slug: input.slug },
				organizationId: input.organizationId,
			});

			if (error) {
				throw new Error(error.message ?? "Could not update the organization.");
			}

			if (!data) {
				throw new Error("Could not update the organization.");
			}

			return data;
		},
	});
}

/** Result of the API delete route. */
export type DeleteOrganizationResult = {
	status: "ok";
	nextOrganizationId: string | null;
	nextSlug: string | null;
};

/**
 * Delete the organization through the API.
 *
 * The route is used instead of the Better Auth client endpoint because the
 * server also resolves the user's next workspace with
 * `resolveSignInOrganization`.
 */
export function useDeleteOrganization() {
	return useMutation({
		mutationFn: async (orgSlug: string): Promise<DeleteOrganizationResult> => {
			const response = await api.orgs({ orgSlug }).delete();

			if (response.error) {
				throw new Error(
					readApiError(response.error, "Could not delete the organization."),
				);
			}

			if (!response.data) {
				throw new Error("Could not delete the organization.");
			}

			return response.data;
		},
	});
}

/** Remove the current user from the organization. */
export function useLeaveOrganization() {
	return useMutation({
		mutationFn: async (organizationId: string) => {
			const { error } = await authClient.organization.leave({ organizationId });

			if (error) {
				throw new Error(error.message ?? "Could not leave the organization.");
			}
		},
	});
}

/**
 * Clear the logo through the API.
 *
 * The route deletes the stored object as well as the database value, which the
 * client cannot do on its own.
 */
export function useRemoveOrganizationLogo() {
	return useMutation({
		mutationFn: async (orgSlug: string) => {
			const response = await api.orgs({ orgSlug }).logo.delete();

			if (response.error) {
				throw new Error(
					readApiError(
						response.error,
						"Could not remove the organization logo.",
					),
				);
			}
		},
	});
}

/**
 * Owners of one organization.
 *
 * The leave card only needs the count. Keeping the query narrow means the
 * future Members page can extend it without changing the card.
 */
export function useOrganizationOwners(organizationId: string, enabled = true) {
	return useQuery({
		queryKey: ["organization", organizationId, "owners"],
		enabled,
		queryFn: async () => {
			const { data, error } = await authClient.organization.listMembers({
				query: { organizationId, limit: 200 },
			});

			if (error) {
				throw new Error(
					error.message ?? "Could not load the organization members.",
				);
			}

			return (data?.members ?? []).filter((member) =>
				roleParts(member.role).includes("owner"),
			);
		},
	});
}
