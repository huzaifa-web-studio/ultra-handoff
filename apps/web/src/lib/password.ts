/**
 * Shared password policy for web forms.
 *
 * Mirrors the API rule in `apps/api/src/lib/password.ts` so a bad password is
 * caught before the request. Kept in one place so sign up, change password,
 * set password and reset password cannot drift apart.
 *
 * The maximum matches Better Auth's `maxPasswordLength`, which the API sets
 * explicitly. Without it a long password passes the browser and is rejected
 * server side with a message the form never explains.
 *
 * Used by: features/auth/schema.ts and features/account/schema.ts.
 */

/** Shortest accepted password. */
export const PASSWORD_MIN = 8;

/** Longest accepted password, matching Better Auth. */
export const PASSWORD_MAX = 128;

/** At least 8 characters with an uppercase, lowercase, number and symbol. */
export const passwordRule = new RegExp(
	`^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z\\d]).{${PASSWORD_MIN},${PASSWORD_MAX}}$`,
);

/** Human readable version of the rule, shown next to password fields. */
export const passwordRuleMessage = `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters with upper, lower, number, and special char`;
