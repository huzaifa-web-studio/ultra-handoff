/**
 * The single rule for "may this session use the account".
 *
 * Why a shared module: Better Auth only enforces `requireEmailVerification`
 * when it creates a session at sign in. A session that already exists, or one
 * created by another path, would keep working if every route decided this for
 * itself. The auth macro, the tenant resolver and the realtime gateway all
 * import the check below so the boundary cannot drift.
 *
 * Used by: src/auth/plugin.ts, src/middleware/tenant.ts and
 * src/realtime/gateway.ts.
 */

/** Response the API returns when a session exists but its email is unproven. */
export const EMAIL_NOT_VERIFIED = {
	code: "EMAIL_NOT_VERIFIED",
	message: "Verify your email address before using your account.",
} as const;

/**
 * True only when Better Auth says the address was confirmed.
 *
 * `=== true` is deliberate: a missing field must fail closed, not fall through
 * as if the address had been proven.
 */
export function isEmailVerified(user: {
	emailVerified?: boolean | null;
}): boolean {
	return user.emailVerified === true;
}
