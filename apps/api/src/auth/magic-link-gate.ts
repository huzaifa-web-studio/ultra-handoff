/**
 * Pure rules for the magic-link sign-in endpoint.
 *
 * Why: Better Auth's magic-link plugin creates a user for any address unless
 * told otherwise. Disabling sign-up outright would break the invitation flow,
 * because a brand new invitee is expected to get an account from the link. The
 * gate therefore allows two cases only: an address that already has a user, or
 * an address with a live pending invitation. Everything else gets the same
 * response as a successful request, so the endpoint cannot be used to probe
 * whether an address is registered.
 *
 * This module stays free of database and environment imports so the rules can
 * be unit tested without a connection.
 *
 * Used by: src/auth/auth.ts.
 */

/** Better Auth's path for requesting a magic link. */
export const MAGIC_LINK_PATH = "/sign-in/magic-link";

/**
 * Normalise an address the same way Better Auth stores it.
 *
 * Returns null for anything that is not a non-empty string, which leaves
 * malformed bodies to the endpoint's own validation.
 */
export function normalizeMagicLinkEmail(value: unknown): string | null {
	if (typeof value !== "string") return null;

	const email = value.trim().toLowerCase();

	return email.length > 0 ? email : null;
}

export type MagicLinkEligibility = {
	/** A user row already exists for the normalised address. */
	userExists: boolean;
	/** A pending, unexpired invitation exists for the normalised address. */
	invitationPending: boolean;
};

/**
 * Decide whether a magic link may be requested for an address.
 *
 * Existing users can always ask for a link. New addresses are allowed only
 * while an invitation proves the mailbox was expected.
 */
export function canRequestMagicLink({
	userExists,
	invitationPending,
}: MagicLinkEligibility): boolean {
	return userExists || invitationPending;
}

/**
 * Resolve where a verified magic link sends the browser.
 *
 * Why: without a callback Better Auth redirects to its own base URL, which is
 * the API origin. A request through the API would then land on the API root
 * instead of the web app. Relative callbacks are resolved against the web
 * origin; an absolute callback on any other origin is replaced rather than
 * trusted.
 *
 * Trusted absolute callbacks are returned unchanged, so the invitation flow
 * keeps its own exact URL.
 */
export function resolveMagicLinkCallback(
	callbackURL: unknown,
	webUrl: string,
): string {
	const fallback = new URL("/", webUrl).toString();

	if (typeof callbackURL !== "string") return fallback;

	const raw = callbackURL.trim();

	if (raw.length === 0) return fallback;

	try {
		const target = new URL(raw, webUrl);
		const webOrigin = new URL(webUrl).origin;

		if (target.origin !== webOrigin) return fallback;

		// Keep an already absolute, trusted URL byte for byte.
		return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : target.toString();
	} catch {
		return fallback;
	}
}
