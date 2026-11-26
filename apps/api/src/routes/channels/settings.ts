/**
 * Channel settings routes.
 *
 * Rename, topic, visibility, archive and restore. Every one is owner only and
 * every one announces a metadata change, never a message.
 *
 * Used by: `routes/channels/index.ts`.
 */

import { Elysia } from "elysia";

import { authErrorMessage, authErrorStatus } from "../../lib/auth-error";
import { tenantPlugin } from "../../middleware/tenant";
import { setChannelArchived, updateChannel } from "../../services/conversation";
import { publishConversationUpdated } from "./publish";
import { channelParams, updateChannelBody } from "./schemas";

export const channelSettingsRoutes = new Elysia({
	name: "channel-settings",
})
	.use(tenantPlugin)
	/** Change the name, topic or visibility of a channel. */
	.patch(
		"/orgs/:orgSlug/conversations/:conversationId",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await updateChannel(tenant, params.conversationId, body);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					params.conversationId,
				);

				return {
					conversation: result.conversation,
					changed: result.changed,
				};
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not save the channel."),
				});
			}
		},
		{ tenant: true, params: channelParams, body: updateChannelBody },
	)
	/** Archive a channel. It becomes read only and leaves the rail. */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/archive",
		async ({ tenant, status, params }) => {
			try {
				const result = await setChannelArchived(
					tenant,
					params.conversationId,
					true,
				);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					params.conversationId,
				);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not archive the channel."),
				});
			}
		},
		{ tenant: true, params: channelParams },
	)
	/** Restore an archived channel. Members and history are unchanged. */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/restore",
		async ({ tenant, status, params }) => {
			try {
				const result = await setChannelArchived(
					tenant,
					params.conversationId,
					false,
				);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					params.conversationId,
				);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not restore the channel."),
				});
			}
		},
		{ tenant: true, params: channelParams },
	);
