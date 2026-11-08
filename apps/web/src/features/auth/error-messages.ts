/**
 * Friendly copy for Better Auth error codes.
 *
 * Why: redirect style failures (OAuth callbacks, verification links, reset
 * links) arrive on the error page as a raw code. Raw codes are not useful to a
 * person, so the known ones are mapped here. The sign-in dialog reuses the same
 * map for social sign-in failures that return before a redirect.
 *
 * Used by: src/routes/auth.error.tsx and src/features/auth/sign-in-form.tsx.
 */

const AUTH_ERROR_MESSAGES: Record<string, string> = {
	INVALID_TOKEN: "This link is invalid, expired, or already used.",
	TOKEN_EXPIRED: "This link has expired. Request a new one.",
	USER_NOT_FOUND: "We could not find an account for this request.",
	FAILED_TO_GET_USER_INFO:
		"We could not load your account. Please sign in again.",
	SESSION_EXPIRED: "Your session expired. Please sign in again.",
	account_not_linked:
		"An account with this email already exists but isn't confirmed yet. We confirm it so nobody else can use your email. Open the confirmation email we sent when you signed up, then try again. Can't find it? Sign in with your password and choose \"Resend verification email\".",
	internal_server_error: "Something went wrong on our side. Please try again.",
};

/**
 * Best available message for a Better Auth failure.
 *
 * Order: a mapped code, then the server supplied description, then the raw
 * code, then the caller's fallback. The mapped code wins because the raw
 * description often repeats the code.
 */
export function resolveAuthErrorMessage(
	error: string | null | undefined,
	errorDescription?: string | null,
	fallback = "Something went wrong. Please try again.",
): string {
	if (error && AUTH_ERROR_MESSAGES[error]) {
		return AUTH_ERROR_MESSAGES[error];
	}

	if (errorDescription) return errorDescription;

	if (error) return `Error: ${error}`;

	return fallback;
}
