/**
 * Member profile route.
 *
 * Why a route of its own instead of extending the members list: the list is a
 * management screen with role and invitation data. A profile is one person and
 * is read every time somebody hovers an avatar, so it stays a small, cacheable
 * read with no write paths.
 *
 * The tenant macro has already resolved `:orgSlug` to a workspace the caller
 * belongs to. The service then proves the target is also a member and applies
 * the project visibility rules.
 *
 * Used by: `src/index.ts`.
 */

import { Elysia, t } from "elysia";

import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { tenantPlugin } from "../middleware/tenant";
import { getMemberProfile } from "../services/member-profile.service";

/** Both parameters must be declared, or Elysia rejects the request. */
const profileParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
	userId: t.String({ minLength: 1, maxLength: 255 }),
});

export const peopleRoutes = new Elysia({ name: "people" })
	.use(tenantPlugin)
	/** One person's profile, limited to what the viewer may already see. */
	.get(
		"/orgs/:orgSlug/people/:userId",
		async ({ tenant, status, params }) => {
			try {
				return await getMemberProfile(tenant, params.userId);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load that profile."),
				});
			}
		},
		{ tenant: true, params: profileParams },
	);
