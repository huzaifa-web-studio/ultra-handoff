/**
 * Project conversation routes.
 *
 * Why a separate plugin: messages inside a project room reuse the conversation
 * endpoints, so the only project specific routes are opening the room and
 * reading its unread count. Keeping them here lets `routes/projects/index.ts`
 * compose them without growing further.
 *
 * Used by: `routes/projects/index.ts`.
 */

import { Elysia } from "elysia";

import { authErrorMessage, authErrorStatus } from "../../lib/auth-error";
import { tenantPlugin } from "../../middleware/tenant";
import {
	getProjectConversationUnread,
	openProjectConversation,
} from "../../services/conversation";
import { projectParams } from "./schemas";

export const projectMessageRoutes = new Elysia({ name: "project-messages" })
	.use(tenantPlugin)
	/**
	 * The unread count for the project Messages tab.
	 *
	 * Registered before the open route so the more specific path is explicit.
	 * It never creates the room, so a project that never used messages costs one
	 * indexed lookup.
	 */
	.get(
		"/orgs/:orgSlug/projects/:projectId/conversation/unread",
		async ({ tenant, status, params }) => {
			try {
				return await getProjectConversationUnread(tenant, params.projectId);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not load the project messages.",
					),
				});
			}
		},
		{ tenant: true, params: projectParams },
	)
	/**
	 * Open the project room.
	 *
	 * Idempotent: the first call creates the room and reconciles participants,
	 * every later call returns the same summary. The room id is derived from
	 * the project id, so two tabs opening at once cannot create two rooms.
	 */
	.get(
		"/orgs/:orgSlug/projects/:projectId/conversation",
		async ({ tenant, status, params }) => {
			try {
				const result = await openProjectConversation(tenant, params.projectId);

				return { conversation: result.conversation };
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(
						error,
						"Could not open the project messages.",
					),
				});
			}
		},
		{ tenant: true, params: projectParams },
	);
