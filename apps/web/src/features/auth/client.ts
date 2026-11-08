import { organizationClient } from "better-auth/client/plugins";
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
	plugins: [organizationClient()],
});
