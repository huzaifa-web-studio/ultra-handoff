/**
 * Shared password policy for the API.
 *
 * Why: sign-up, password reset, change password and set password all have to
 * enforce exactly the same rule. Keeping the expression and the message here
 * stops those four endpoints from drifting apart over time.
 *
 * The maximum matches Better Auth's `maxPasswordLength`, set explicitly in
 * `src/auth/auth.ts`, so the API rejects an over long password with the same
 * message the browser shows instead of a library error.
 *
 * Used by: src/auth/auth.ts (the before hook) and src/routes/account.ts.
 */

/** Shortest accepted password. */
export const PASSWORD_MIN = 8;

/** Longest accepted password, matching Better Auth. */
export const PASSWORD_MAX = 128;

/** At least 8 characters with an uppercase, lowercase, number and symbol. */
export const passwordRegex = new RegExp(
	`^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z\\d]).{${PASSWORD_MIN},${PASSWORD_MAX}}$`,
);

/** Human readable version of the rule, reused in API errors. */
export const passwordRuleMessage = `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters with uppercase, lowercase, number, and special character`;

/**
 * Check a password against the shared policy.
 *
 * Wrapped in a function so callers do not need to know which expression is
 * used, and so a future move to a strength estimator only touches this file.
 */
export function isValidPassword(password: string): boolean {
	return passwordRegex.test(password);
}
