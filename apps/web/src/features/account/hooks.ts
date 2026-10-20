/**
 * Account data hooks.
 *
 * Why react-query for the account list: linking and unlinking happen outside
 * the React tree (OAuth redirect) and need a refetch after the browser
 * returns. A query gives that for free and keeps loading and error states
 * consistent with the rest of the app.
 *
 * Used by: src/features/account/sign-in-methods.tsx and profile-card.tsx.
 */

import { useMutation, useQuery } from "@tanstack/react-query";

import { authClient } from "#/features/auth/client";

/** The subset of a Better Auth account row the UI needs. */
export type LinkedAccount = {
	id: string;
	providerId: string;
};

export type SocialProvider = "google" | "github";

/** Every authentication method linked to the current user. */
export function useLinkedAccounts() {
	return useQuery({
		queryKey: ["account", "linked-accounts"],
		queryFn: async (): Promise<LinkedAccount[]> => {
			const { data, error } = await authClient.listAccounts();

			if (error) {
				throw new Error(
					error.message ?? "Could not load your sign-in methods.",
				);
			}

			return data ?? [];
		},
	});
}

/** Update the display name. */
export function useUpdateProfile() {
	return useMutation({
		mutationFn: async (name: string) => {
			const { error } = await authClient.updateUser({ name });

			if (error) {
				throw new Error(error.message ?? "Could not update your profile.");
			}
		},
	});
}

/**
 * Start the OAuth link flow.
 *
 * `linkSocial` navigates away, so a successful call may never resolve in this
 * tab. The callback returns to `/account`, where the query refetches.
 */
export function useLinkAccount() {
	return useMutation({
		mutationFn: async (provider: SocialProvider) => {
			const { error } = await authClient.linkSocial({
				provider,
				callbackURL: `${window.location.origin}/account`,
			});

			if (error) {
				throw new Error(
					error.message ?? "Could not start linking that provider.",
				);
			}
		},
	});
}

/** Remove one linked method. Better Auth blocks removing the last one. */
export function useUnlinkAccount() {
	return useMutation({
		mutationFn: async (accountId: string) => {
			const { error } = await authClient.unlinkAccount({ accountId });

			if (error) {
				throw new Error(
					error.message ?? "Could not disconnect that sign-in method.",
				);
			}
		},
	});
}
