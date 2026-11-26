/**
 * Channel membership routes.
 *
 * Join, leave, add, remove, promote and mute. Each handler only parses, calls
 * the service and announces the change. The rules themselves live in
 * `services/conversation/channels/membership.ts`.
 *
 * Used by: `routes/channels/index.ts`.
 */

import { Elysia } from "elysia";

import { authErrorMessage, authErrorStatus } from "../../lib/auth-error";
import { tenantPlugin } from "../../middleware/tenant";
import {
	addChannelMembers,
	joinChannel,
	leaveChannel,
	removeChannelMember,
	setChannelMemberRole,
	setChannelMuted,
} from "../../services/conversation";
import { publishConversationUpdated, publishMemberChanged } from "./publish";
import {
	addMembersBody,
	channelParams,
	memberParams,
	updateMemberBody,
} from "./schemas";

export const channelMembershipRoutes = new Elysia({
	name: "channel-membership",
})
	.use(tenantPlugin)
	/** Join a public channel. A private one answers 404 to a non-member. */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/join",
		async ({ tenant, status, params }) => {
			try {
				const result = await joinChannel(tenant, params.conversationId);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					params.conversationId,
				);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not join the channel."),
				});
			}
		},
		{ tenant: true, params: channelParams },
	)
	/** Leave a channel. The last owner cannot leave. */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/leave",
		async ({ tenant, status, params }) => {
			try {
				const result = await leaveChannel(tenant, params.conversationId);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					params.conversationId,
				);
				publishMemberChanged(
					tenant.organizationId,
					tenant.userId,
					params.conversationId,
					"removed",
				);

				return { conversationId: result.conversationId };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not leave the channel."),
				});
			}
		},
		{ tenant: true, params: channelParams },
	)
	/** Add people. Owner only. */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/members",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await addChannelMembers(
					tenant,
					params.conversationId,
					body.userIds,
				);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					params.conversationId,
				);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not add those people."),
				});
			}
		},
		{ tenant: true, params: channelParams, body: addMembersBody },
	)
	/** Remove one member. Owner only. */
	.delete(
		"/orgs/:orgSlug/conversations/:conversationId/members/:userId",
		async ({ tenant, status, params }) => {
			try {
				const result = await removeChannelMember(
					tenant,
					params.conversationId,
					params.userId,
				);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					params.conversationId,
				);
				publishMemberChanged(
					tenant.organizationId,
					result.removedUserId,
					params.conversationId,
					"removed",
				);

				return {
					conversationId: params.conversationId,
					removedUserId: result.removedUserId,
				};
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not remove that person."),
				});
			}
		},
		{ tenant: true, params: memberParams },
	)
	/** Promote or demote one member. Owner only. */
	.patch(
		"/orgs/:orgSlug/conversations/:conversationId/members/:userId",
		async ({ tenant, status, params, body }) => {
			try {
				const result = await setChannelMemberRole(
					tenant,
					params.conversationId,
					params.userId,
					body.role,
				);

				publishConversationUpdated(
					tenant.organizationId,
					result.participantIds,
					params.conversationId,
				);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not change that role."),
				});
			}
		},
		{ tenant: true, params: memberParams, body: updateMemberBody },
	)
	/** Mute the channel for the viewer. Unread still counts, alerts do not. */
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/mute",
		async ({ tenant, status, params }) => {
			try {
				const result = await setChannelMuted(
					tenant,
					params.conversationId,
					true,
				);

				publishConversationUpdated(
					tenant.organizationId,
					[tenant.userId],
					params.conversationId,
				);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not mute the channel."),
				});
			}
		},
		{ tenant: true, params: channelParams },
	)
	.post(
		"/orgs/:orgSlug/conversations/:conversationId/unmute",
		async ({ tenant, status, params }) => {
			try {
				const result = await setChannelMuted(
					tenant,
					params.conversationId,
					false,
				);

				publishConversationUpdated(
					tenant.organizationId,
					[tenant.userId],
					params.conversationId,
				);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not unmute the channel."),
				});
			}
		},
		{ tenant: true, params: channelParams },
	);
