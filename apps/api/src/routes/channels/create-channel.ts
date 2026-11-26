/**
 * Create channel route.
 *
 * Why a route file: create has its own body and its own realtime announcement.
 * Keeping it separate from the directory reads means neither file has to be
 * read to understand the other.
 *
 * Used by: `routes/channels/index.ts`.
 */

import { Elysia } from "elysia";

import { authErrorMessage, authErrorStatus } from "../../lib/auth-error";
import { tenantPlugin } from "../../middleware/tenant";
import { createChannel } from "../../services/conversation";
import { publishConversationUpdated } from "./publish";
import { createChannelBody } from "./schemas";

export const createChannelRoutes = new Elysia({ name: "create-channel" })
	.use(tenantPlugin)
	/** Create a public or private channel and add its first members. */
	.post(
		"/orgs/:orgSlug/channels",
		async ({ tenant, status, body }) => {
			try {
				const result = await createChannel(tenant, body);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					result.conversation.id,
				);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not create the channel."),
				});
			}
		},
		{ tenant: true, body: createChannelBody },
	);
