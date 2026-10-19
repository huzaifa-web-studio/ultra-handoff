import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for the web app.
 * Talks to the API's mounted auth handler at /api/auth/*.
 */
export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_API_URL || "http://localhost:3001",
	plugins: [organizationClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
