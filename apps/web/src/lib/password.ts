/**
 * Shared password policy for web forms.
 *
 * Mirrors the API rule in `apps/api/src/lib/password.ts` so a bad password is
 * caught before the request. Kept in one place so sign up, change password,
 * set password and reset password cannot drift apart.
 *
 * Used by: features/auth/schema.ts and features/account/schema.ts.
 */

/** At least 8 characters with an uppercase, lowercase, number and symbol. */
export const passwordRule =
	/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;

/** Human readable version of the rule, shown next to password fields. */
export const passwordRuleMessage =
	"Password must be 8+ characters with upper, lower, number, and special char";
