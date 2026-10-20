/**
 * Shared password policy for the API.
 *
 * Why: sign-up, password reset, change password and set password all have to
 * enforce exactly the same rule. Keeping the expression and the message here
 * stops those four endpoints from drifting apart over time.
 *
 * Used by: src/auth/auth.ts (the before hook) and src/routes/account.ts.
 */

/** At least 8 characters with an uppercase, lowercase, number and symbol. */
export const passwordRegex =
	/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

/** Human readable version of the rule, reused in API errors. */
export const passwordRuleMessage =
	"Password must be at least 8 characters with uppercase, lowercase, number, and special character";

/**
 * Check a password against the shared policy.
 *
 * Wrapped in a function so callers do not need to know which expression is
 * used, and so a future move to a strength estimator only touches this file.
 */
export function isValidPassword(password: string): boolean {
	return passwordRegex.test(password);
}
