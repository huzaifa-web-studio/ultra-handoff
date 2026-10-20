import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { openAPI, organization } from "better-auth/plugins";

import { adminDb } from "../db";
import { authEnv, isDevelopment, serverEnv } from "../lib/env";
import { passwordRegex, passwordRuleMessage } from "../lib/password";
import { enqueueEmail } from "../queues/email";
import { getAccountDeletionBlocker } from "../services/account.service";
import { deletePreviousAvatar } from "../services/upload.service";
import { authSecondaryStorage } from "./secondary-storage";

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
	// Sessions, verification tokens and rate limit counters live in Redis.
	// `storeSessionInDatabase` keeps a durable copy, so a Redis restart falls
	// back to Postgres instead of signing every user out.
	secondaryStorage: authSecondaryStorage,
	session: {
		storeSessionInDatabase: true,
	},
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
				await enqueueEmail({
					to: user.email,
					template: "delete-account",
					url,
				});
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
		// Reset links stay valid for one hour. The email and the forgot
		// password screen both state this expiry, so keep them in sync.
		resetPasswordTokenExpiresIn: 60 * 60,
		// A reset usually means someone else may have had access. Sign out
		// every device, including the one that opened the link.
		revokeSessionsOnPasswordReset: true,
		sendResetPassword: async ({ user, url }) => {
			await enqueueEmail({ to: user.email, template: "reset-password", url });
		},
	},
	emailVerification: {
		// One hour is Better Auth's default, stated here because the sign-up
		// screen tells the user how long the link stays valid.
		expiresIn: 60 * 60,
		sendVerificationEmail: async ({ user, url }) => {
			const verifyUrl = new URL(url);
			// Send the browser back to the web app with a flag the home page
			// turns into a confirmation. Without it the redirect is silent.
			const verifiedUrl = new URL(serverEnv.webUrl);
			verifiedUrl.searchParams.set("verified", "1");
			verifyUrl.searchParams.set("callbackURL", verifiedUrl.toString());

			await enqueueEmail({
				to: user.email,
				template: "verification",
				url: verifyUrl.toString(),
			});
		},
		sendOnSignUp: true,
		sendOnSignIn: true,
		autoSignInAfterVerification: true,
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			// Sign-up with an existing email must fail loudly. Better Auth
			// returns a generic success when email verification is required,
			// which leaves the user waiting for a link that is never sent.
			// The trade-off is that this reveals whether an address is
			// registered, which is acceptable for a client-facing app where
			// the user needs a clear next step.
			if (ctx.path === "/sign-up/email") {
				const email = ctx.body?.email;

				if (typeof email === "string") {
					const existing = await ctx.context.internalAdapter.findUserByEmail(
						email.trim().toLowerCase(),
					);

					if (existing?.user) {
						throw new APIError("UNPROCESSABLE_ENTITY", {
							message:
								"An account with this email already exists. Sign in instead.",
						});
					}
				}
			}

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
