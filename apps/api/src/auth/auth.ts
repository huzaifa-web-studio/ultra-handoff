import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { openAPI, organization } from "better-auth/plugins";

import { adminDb } from "../db";
import { authEnv, isDevelopment, isProduction, serverEnv } from "../lib/env";
import {
	sendDeleteAccountEmail,
	sendResetPasswordEmail,
	sendVerificationEmail,
} from "../lib/mailer";
import { passwordRegex, passwordRuleMessage } from "../lib/password";
import { getAccountDeletionBlocker } from "../services/account.service";
import { deletePreviousAvatar } from "../services/upload.service";

/**
 * Better Auth instance for the Handoff API.
 * Provides email/password auth, GitHub + Google social login, and the
 * organization plugin for agency/client workspaces.
 *
 * Used by: Elysia plugin in src/auth/plugin.ts.
 * Env: BETTER_AUTH_SECRET, BETTER_AUTH_URL, DATABASE_URL,
 *      GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET,
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 */
export const auth = betterAuth({
	secret: authEnv.secret || undefined,
	baseURL: authEnv.url,
	// Runs on the privileged client on purpose: Better Auth reads across
	// organizations (list orgs, accept invitation, setActive), which RLS on
	// organization/member/invitation would block.
	database: drizzleAdapter(adminDb, { provider: "pg" }),
	user: {
		deleteUser: {
			// Disabled by default in Better Auth. The account page owns the UI
			// and the confirmation, but the deletion itself stays in the
			// library so sessions and linked accounts cascade correctly.
			enabled: true,
			sendDeleteAccountVerification: async ({ user, url }) => {
				// Check before sending anything. A blocked user should see the
				// reason in the account card, not receive an email that can
				// only fail when the link is opened.
				const blocker = await getAccountDeletionBlocker(user.id);
				if (blocker) {
					throw new APIError("BAD_REQUEST", { message: blocker });
				}

				// Required for Google and GitHub users, who have no password to
				// re-enter before a destructive action.
				await sendDeleteAccountEmail(user.email, url);
			},
			beforeDelete: async (user) => {
				// Final safeguard for a direct API call that skipped the
				// preflight check. The same rule as the card and the email
				// callback, from one shared helper.
				const blocker = await getAccountDeletionBlocker(user.id);
				if (blocker) {
					throw new APIError("BAD_REQUEST", { message: blocker });
				}

				// Best effort. The user row still exists here, so we have the
				// image URL needed to find the object in SeaweedFS.
				await deletePreviousAvatar(user.id, user.image);
			},
		},
	},
	emailAndPassword: {
		enabled: true,
		minPasswordLength: 8,
		requireEmailVerification: true,
		autoSignIn: true,
		sendResetPassword: async ({ user, url }) => {
			await sendResetPasswordEmail(user.email, url);
		},
	},
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			if (!isProduction) {
				console.log("[auth] sending verification email to", user.email, url);
			}
			const verifyUrl = new URL(url);
			verifyUrl.searchParams.set("callbackURL", serverEnv.webUrl);
			await sendVerificationEmail(user.email, verifyUrl.toString());
		},
		sendOnSignUp: true,
		sendOnSignIn: true,
		autoSignInAfterVerification: true,
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			// Every endpoint that writes a password enforces the same rule.
			// `set-password` and `change-password` are included so a caller
			// cannot skip the policy by using a different route.
			const passwordPaths = [
				"/sign-up/email",
				"/reset-password",
				"/change-password",
				"/set-password",
			];

			if (passwordPaths.includes(ctx.path)) {
				const password = ctx.body?.password ?? ctx.body?.newPassword;
				if (password && !passwordRegex.test(password)) {
					throw new APIError("BAD_REQUEST", {
						message: passwordRuleMessage,
					});
				}
			}
		}),
	},
	socialProviders: {
		github: {
			clientId: authEnv.github.clientId,
			clientSecret: authEnv.github.clientSecret,
		},
		google: {
			clientId: authEnv.google.clientId,
			clientSecret: authEnv.google.clientSecret,
		},
	},
	plugins: [organization(), ...(isDevelopment ? [openAPI()] : [])],
	trustedOrigins: [
		authEnv.url,
		// The web origin is what the browser sends. In production this is the
		// public app URL, so it must not be left as a localhost default.
		serverEnv.webUrl,
		// Local ports stay allowed in development only. Keeping them out of
		// production avoids trusting an origin that can never be correct there.
		...(isDevelopment
			? ["http://localhost:3000", "http://localhost:3001"]
			: []),
	],
});

export type Auth = typeof auth;
