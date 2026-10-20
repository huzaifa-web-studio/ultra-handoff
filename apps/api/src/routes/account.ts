/**
 * Account routes that Better Auth cannot expose directly to the browser.
 *
 * Why this exists: Better Auth declares `setPassword` with
 * `createAuthEndpoint.serverOnly`, so the endpoint is deliberately absent from
 * the client SDK. A social-only user still needs a way to add a password, and
 * the browser cannot call the server-only endpoint through `authClient`. This
 * route is the thin authenticated proxy to `auth.api.setPassword`.
 *
 * Change password does NOT need a route: it is a normal client endpoint and
 * still requires the current password, so it is called through `authClient`.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import { auth } from "../auth/auth";
import { authMacro } from "../auth/plugin";
import { isValidPassword, passwordRuleMessage } from "../lib/password";
import { getAccountDeletionBlocker } from "../services/account.service";

export const accountRoutes = new Elysia()
	.use(authMacro)
	/**
	 * Preflight for the delete account card.
	 *
	 * Why: Better Auth's email step happens before `beforeDelete`, so without
	 * this check the user would receive an email even when the deletion is
	 * blocked by organization ownership. Returning the reason here lets the
	 * card show it before any email is sent.
	 */
	.get(
		"/account/delete-check",
		async ({ user }) => {
			const blocker = await getAccountDeletionBlocker(user.id);

			if (blocker) {
				return { allowed: false as const, reason: blocker };
			}

			return { allowed: true as const };
		},
		{ auth: true },
	)
	/**
	 * Add a password to an account that signed up with a social provider.
	 *
	 * The explicit credential check is important: without it this endpoint
	 * would let a session skip the current-password prompt that
	 * `changePassword` enforces.
	 */
	.post(
		"/account/password",
		async ({ body, request, status }) => {
			if (!isValidPassword(body.newPassword)) {
				return status(400, { message: passwordRuleMessage });
			}

			const accounts = await auth.api.listUserAccounts({
				headers: request.headers,
			});

			if (accounts.some((account) => account.providerId === "credential")) {
				return status(409, {
					message:
						"This account already has a password. Use change password instead.",
				});
			}

			await auth.api.setPassword({
				body: { newPassword: body.newPassword },
				headers: request.headers,
			});

			return { status: "ok" as const };
		},
		{
			auth: true,
			body: t.Object({
				newPassword: t.String({ minLength: 8, maxLength: 128 }),
			}),
		},
	);
