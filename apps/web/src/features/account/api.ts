/**
 * Account API calls that cannot go through the Better Auth client.
 *
 * `setPassword` is a server only endpoint in Better Auth, so a social user
 * needs this thin wrapper. Everything else (name, avatar, linked accounts,
 * change password) uses `authClient` directly.
 *
 * Used by: src/features/account/password-card.tsx.
 */

import { api, readApiError } from "#/lib/api";

/**
 * Add a password to a social-only account.
 *
 * The API rejects the request if a credential account already exists, so this
 * can never be used to bypass the current-password check.
 */
export async function setAccountPassword(newPassword: string): Promise<void> {
	const response = await api.account.password.post({ newPassword });

	if (response.error) {
		throw new Error(
			readApiError(response.error, "Could not set the password."),
		);
	}
}
