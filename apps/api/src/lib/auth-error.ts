import { type APIError, isAPIError } from "better-auth/api";

/**
 * Turn a Better Auth error into a message a person can act on.
 *
 * Why: the organization plugin throws codes such as
 * `ORGANIZATION_MEMBERSHIP_LIMIT_REACHED`. Returning that string to the browser
 * produces a UI that looks broken. The members and invitations services catch
 * Better Auth failures per item, so this module is the single place that maps
 * known codes to copy and keeps unknown failures generic.
 *
 * Used by: src/services/member.service.ts and
 * src/services/invitation.service.ts.
 */

const AUTH_ERROR_MESSAGES: Record<string, string> = {
	ORGANIZATION_MEMBERSHIP_LIMIT_REACHED:
		"This workspace has no seats left. Remove a member or raise the limit first.",
	INVITATION_LIMIT_REACHED:
		"There are too many pending invitations. Cancel one before sending another.",
	USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
		"That person is already a member of this workspace.",
	USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
		"That person already has a pending invitation.",
	YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
		"You do not have permission to invite people to this workspace.",
	YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION:
		"You do not have permission to cancel this invitation.",
	YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER:
		"You do not have permission to change that member.",
	YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER:
		"You do not have permission to remove that member.",
	YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER:
		"An organization needs at least one owner.",
	YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
		"The last owner cannot be removed or demoted.",
	ROLE_NOT_FOUND: "That role is not available in this workspace.",
	INVITATION_NOT_FOUND: "That invitation is no longer available.",
	YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
		"This invitation was sent to a different email address.",
	EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
		"Verify your email address before accepting this invitation.",
	EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION:
		"Verify your email address before opening this invitation.",
	INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION:
		"The person who sent this invitation is no longer a member of the workspace.",
	ORGANIZATION_NOT_FOUND: "This workspace no longer exists.",
	MEMBER_NOT_FOUND: "That member is no longer part of this workspace.",
	NO_ACTIVE_ORGANIZATION: "No workspace is selected.",
};

/** Read the Better Auth error code without trusting the error shape. */
export function readAuthErrorCode(error: unknown): string | null {
	if (!isAPIError(error)) return null;

	const body = (error as APIError).body as { code?: unknown } | undefined;

	return typeof body?.code === "string" ? body.code : null;
}

/**
 * Best available user facing message for a failure.
 *
 * Order: a mapped code, then the library's own message, then the caller's
 * fallback. The mapped code wins because the library message often contains the
 * code itself.
 */
export function authErrorMessage(error: unknown, fallback: string): string {
	const code = readAuthErrorCode(error);

	if (code && AUTH_ERROR_MESSAGES[code]) {
		return AUTH_ERROR_MESSAGES[code];
	}

	if (error instanceof Error && error.message) {
		return error.message;
	}

	return fallback;
}

/**
 * HTTP status for an APIError, narrowed to the literals Elysia accepts.
 *
 * Why: `APIError.status` is either a numeric code or a status name such as
 * "BAD_REQUEST", while `status()` expects a numeric literal. Mapping keeps the
 * response honest instead of flattening every library failure to 500.
 */
export function authErrorStatus(
	error: unknown,
): 400 | 401 | 403 | 404 | 409 | 422 | 429 {
	if (!isAPIError(error)) return 409;

	const status = (error as APIError).status;

	if (typeof status === "number") {
		switch (status) {
			case 400:
			case 401:
			case 403:
			case 404:
				return status;
			case 422:
				return 422;
			case 429:
				return 429;
			default:
				return 409;
		}
	}

	switch (status) {
		case "BAD_REQUEST":
			return 400;
		case "UNAUTHORIZED":
			return 401;
		case "FORBIDDEN":
			return 403;
		case "NOT_FOUND":
			return 404;
		case "UNPROCESSABLE_ENTITY":
			return 422;
		case "TOO_MANY_REQUESTS":
			return 429;
		default:
			return 409;
	}
}
