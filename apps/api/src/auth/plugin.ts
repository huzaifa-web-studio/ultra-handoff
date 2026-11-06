import { Elysia } from "elysia";
import { auth } from "./auth";
import { EMAIL_NOT_VERIFIED, isEmailVerified } from "./verified";

/**
 * Session gate shared by every protected route group.
 *
 * Kept separate from the mounted auth handler so route modules can `.use()`
 * the macro without mounting `/api/auth/*` a second time. Elysia deduplicates
 * named plugins, so using it in both places is safe.
 *
 * Used by: src/auth/plugin.ts and route modules that declare `{ auth: true }`.
 */
export const authMacro = new Elysia({ name: "better-auth-macro" }).macro({
	auth: {
		async resolve({ status, request: { headers } }) {
			const session = await auth.api.getSession({ headers });
			if (!session) return status(401);
			// A session alone is not enough. An account whose address was never
			// confirmed cannot read or write its own data, which is what makes
			// `requireEmailVerification` hold for sessions that already exist.
			if (!isEmailVerified(session.user)) {
				return status(403, EMAIL_NOT_VERIFIED);
			}
			return {
				user: session.user,
				session: session.session,
			};
		},
	},
});

/**
 * Elysia plugin that mounts the Better Auth handler and adds an `auth` macro.
 * Routes can opt into session protection with `{ auth: true }`.
 *
 * Used by: src/index.ts.
 */
export const betterAuth = new Elysia({ name: "better-auth" })
	.use(authMacro)
	.mount(auth.handler);
