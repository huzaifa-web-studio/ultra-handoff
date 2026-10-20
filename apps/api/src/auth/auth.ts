import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { openAPI, organization } from "better-auth/plugins";

import { adminDb } from "../db";
import { authEnv, isDevelopment, isProduction, serverEnv } from "../lib/env";
import { sendResetPasswordEmail, sendVerificationEmail } from "../lib/mailer";

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

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
			if (ctx.path === "/sign-up/email" || ctx.path === "/reset-password") {
				const password = ctx.body?.password ?? ctx.body?.newPassword;
				if (password && !passwordRegex.test(password)) {
					throw new APIError("BAD_REQUEST", {
						message:
							"Password must be at least 8 characters with uppercase, lowercase, number, and special character",
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
		"http://localhost:3000",
		"http://localhost:3001",
	],
});

export type Auth = typeof auth;
