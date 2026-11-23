/**
 * Web Push subscription routes.
 *
 * These are account level, not workspace level: a browser has one push
 * subscription and should receive every workspace's alerts with it. The route
 * uses the session macro and the user-only RLS policy instead of the tenant
 * macro.
 *
 * The public VAPID key is served here so the web bundle does not need a second
 * build time variable.
 *
 * Used by: src/index.ts and features/notifications/push.ts.
 */

import { Elysia, t } from "elysia";

import { authMacro } from "../auth/plugin";
import {
	getPushConfig,
	removePushSubscription,
	savePushSubscription,
} from "../services/push.service";

export const pushRoutes = new Elysia({ name: "push" })
	.use(authMacro)
	/** Whether this deployment can push, and the key the browser needs. */
	.get("/account/push/config", () => getPushConfig(), { auth: true })
	/** Register or refresh one browser subscription. */
	.post(
		"/account/push/subscriptions",
		async ({ user, status, body }) => {
			try {
				return await savePushSubscription(user.id, {
					endpoint: body.endpoint,
					p256dh: body.keys.p256dh,
					auth: body.keys.auth,
					userAgent: body.userAgent,
				});
			} catch {
				return status(400, { message: "That push subscription is not valid." });
			}
		},
		{
			auth: true,
			body: t.Object({
				endpoint: t.String({ minLength: 1, maxLength: 2_000 }),
				keys: t.Object({
					p256dh: t.String({ minLength: 1, maxLength: 500 }),
					auth: t.String({ minLength: 1, maxLength: 500 }),
				}),
				userAgent: t.Optional(t.String({ maxLength: 400 })),
			}),
		},
	)
	/** Remove the subscription for this browser. */
	.delete(
		"/account/push/subscriptions",
		async ({ user, body }) => removePushSubscription(user.id, body.endpoint),
		{
			auth: true,
			body: t.Object({
				endpoint: t.String({ minLength: 1, maxLength: 2_000 }),
			}),
		},
	);
