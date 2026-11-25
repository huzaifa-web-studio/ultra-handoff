import {
	inferAdditionalFields,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { API_ORIGIN } from "#/lib/api-base";

/**
 * Better Auth client for the web app.
 * Talks to the API's mounted auth handler at /api/auth/*.
 *
 * The origin comes from `lib/api-base.ts`, the same source Eden Treaty and the
 * realtime socket use. A production build refuses to run without
 * `VITE_API_URL`, so the auth client never calls localhost from a deployment.
 *
 * Why only `authClient` is exported: the app calls every endpoint through this
 * one object (`authClient.signIn.email`, `authClient.useSession`,
 * `authClient.listAccounts`, `authClient.changePassword`, ...). Exporting
 * destructured aliases created a second, unused way to do the same thing, so
 * there is now a single import shape across sign-in, sign-up, organization and
 * account settings.
 */
export const authClient = createAuthClient({
	baseURL: API_ORIGIN,
	plugins: [
		organizationClient(),
		/**
		 * The fields the API declares in `user.additionalFields`.
		 *
		 * Why listed here: importing the server `auth` instance just for type
		 * inference would pull the API module graph into the web type check. The
		 * list is small and the API validators remain authoritative, so the
		 * documented separate-project form is the safer trade. Keep it in sync
		 * with `apps/api/src/auth/auth.ts`.
		 */
		inferAdditionalFields({
			user: {
				timezone: { type: "string", required: false },
				jobTitle: { type: "string", required: false },
				bio: { type: "string", required: false },
				location: { type: "string", required: false },
			},
		}),
	],
});
