import { Elysia } from "elysia";

import { auth } from "./auth";

/**
 * Elysia plugin that mounts the Better Auth handler and adds an `auth` macro.
 * Routes can opt into session protection with `{ auth: true }`.
 *
 * Used by: src/index.ts.
 */
export const betterAuth = new Elysia({ name: "better-auth" })
	.mount(auth.handler)
	.macro({
		auth: {
			async resolve({ status, request: { headers } }) {
				const session = await auth.api.getSession({ headers });
				if (!session) return status(401);
				return {
					user: session.user,
					session: session.session,
				};
			},
		},
	});
