import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for the web app.
 * Talks to the API's mounted auth handler at /api/auth/*.
 *
 * Why only `authClient` is exported: the app calls every endpoint through this
 * one object (`authClient.signIn.email`, `authClient.useSession`,
 * `authClient.listAccounts`, `authClient.changePassword`, ...). Exporting
 * destructured aliases created a second, unused way to do the same thing, so
 * there is now a single import shape across sign-in, sign-up, organization and
 * account settings.
 */
export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_API_URL || "http://localhost:3001",
	plugins: [organizationClient()],
});
