/**
 * Account linking policy for social sign-in.
 *
 * Implicit same-email linking is allowed on purpose, so a person with a
 * verified password account can also use GitHub or Google for the same
 * address. The safety comes from `requireLocalEmailVerified`, not from turning
 * linking off.
 *
 * Why that flag matters: sign-up always writes `emailVerified: false`, and
 * this app also requires verification before a password account can sign in.
 * Better Auth therefore refuses to link an OAuth identity into an existing
 * local row whose address was never verified. That is what stops the
 * pre-registration takeover: an attacker who registers a victim's address with
 * a password they chose cannot verify it, so the victim's later Google
 * sign-in is rejected with `account_not_linked` instead of activating the
 * attacker's password.
 *
 * `requireLocalEmailVerified` defaults to true in Better Auth 1.7 and becomes
 * unconditional in the next minor. It is stated here so a future default
 * change cannot silently reopen the hole, and so the upgrade that removes the
 * option surfaces as a type error.
 *
 * Exported as a constant so the policy can be asserted in a unit test without
 * booting the auth instance or connecting to the database.
 *
 * Used by: src/auth/auth.ts.
 */

export const ACCOUNT_LINKING_OPTIONS: {
	enabled: boolean;
	requireLocalEmailVerified: boolean;
	trustedProviders: string[];
} = {
	enabled: true,
	requireLocalEmailVerified: true,
	// Kept for explicit linking from an authenticated session too.
	trustedProviders: ["github", "google"],
};
