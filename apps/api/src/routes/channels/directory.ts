/**
 * Channel directory routes.
 *
 * Why two reads: the rail needs every joined channel, including one with no
 * messages yet, and the browser needs a search over public channels. They have
 * different access rules, so they are separate endpoints.
 *
 * Used by: `routes/channels/index.ts`.
 */

import { Elysia } from "elysia";

import { authErrorMessage, authErrorStatus } from "../../lib/auth-error";
import { clampLimit } from "../../lib/pagination";
import { tenantPlugin } from "../../middleware/tenant";
import {
	browseChannels,
	CHANNEL_BROWSE_DEFAULT,
	CHANNEL_BROWSE_MAX,
	listArchivedChannels,
	listChannels,
} from "../../services/conversation";
import { browseQuery } from "./schemas";

export const channelDirectoryRoutes = new Elysia({
	name: "channel-directory",
})
	.use(tenantPlugin)
	/** Every channel the viewer has joined, including empty ones. */
	.get(
		"/orgs/:orgSlug/channels",
		async ({ tenant, status }) => {
			try {
				return await listChannels(tenant);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load your channels."),
				});
			}
		},
		{ tenant: true },
	)
	/**
	 * Channels the viewer still belongs to that an owner archived.
	 *
	 * Restore is only reachable from a list, so this has to exist even though
	 * an archived channel never appears in the rail or in browse.
	 */
	.get(
		"/orgs/:orgSlug/channels/archived",
		async ({ tenant, status }) => {
			try {
				return await listArchivedChannels(tenant);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not load the archived channels.",
					),
				});
			}
		},
		{ tenant: true },
	)
	/**
	 * Public channels in the workspace.
	 *
	 * Registered before any parameter route so `browse` is never read as an id.
	 */
	.get(
		"/orgs/:orgSlug/channels/browse",
		async ({ tenant, status, query }) => {
			try {
				return await browseChannels(tenant, {
					search: query.search ?? "",
					cursor: query.cursor ?? null,
					limit: clampLimit(
						query.limit,
						CHANNEL_BROWSE_DEFAULT,
						CHANNEL_BROWSE_MAX,
					),
				});
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load the channels."),
				});
			}
		},
		{ tenant: true, query: browseQuery },
	);
