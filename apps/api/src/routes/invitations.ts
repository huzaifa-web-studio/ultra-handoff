import { Elysia, t } from "elysia";

import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import {
	previewInvitation,
	sendInvitationMagicLink,
} from "../services/invitation.service";

/**
 * Public invitation routes.
 *
 * Why public: the invitee clicks an emailed link and usually has no session
 * yet. The page needs the organization name, inviter and role before sign in,
 * and needs a way to request a magic link for the invited address. Neither
 * route mutates membership. Acceptance still happens through Better Auth, which
 * checks that the session email matches the invitation.
 *
 * Security: the invitation id is the bearer token and the preview never returns
 * the full invited address. The magic link is always sent to the invitation's
 * own email, never to an address supplied by the caller, and is rate limited
 * per invitation.
 *
 * Used by: src/index.ts.
 */

const invitationParams = t.Object({
	invitationId: t.String({ minLength: 1, maxLength: 255 }),
});

export const publicInvitationRoutes = new Elysia({
	name: "public-invitations",
})
	/** Preview an invitation by id for the accept page. */
	.get(
		"/invitations/:invitationId",
		async ({ params, request, status }) => {
			try {
				const preview = await previewInvitation(
					params.invitationId,
					request.headers,
				);

				if (!preview) {
					return status(404, {
						message: "This invitation link is not valid.",
					});
				}

				return preview;
			} catch {
				return status(409, {
					message: "Could not load this invitation. Try again.",
				});
			}
		},
		{ params: invitationParams },
	)
	/**
	 * Email a one-time sign in link to the invited address.
	 *
	 * Returns "sent" for a valid pending invitation. The accept page shows a
	 * neutral confirmation, so this response never reveals whether an account
	 * already exists for the address.
	 */
	.post(
		"/invitations/:invitationId/magic-link",
		async ({ params, request, status }) => {
			try {
				return await sendInvitationMagicLink(
					params.invitationId,
					request.headers,
				);
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not send a sign-in link."),
				});
			}
		},
		{ params: invitationParams },
	);
