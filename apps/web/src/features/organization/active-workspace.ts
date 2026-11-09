/**
 * One active organization per session.
 *
 * Why: Better Auth stores a single active organization on the session, and the
 * product only ever opens that one. Business routes are slug scoped on the API,
 * so a URL naming another workspace is not a data risk, but it lets a stale
 * bookmark, an old link or a hand edited address render a workspace the session
 * is not using. It reads as a second open workspace and the navigation stops
 * matching what the person expects.
 *
 * The rule: when the URL names a workspace other than the active one, the app
 * goes back to the active one instead of rendering it. While the active
 * organization is still loading the app waits, so the wrong workspace never
 * flashes on screen first.
 *
 * The URL is replaced rather than switched into the session. The active
 * organization only changes through `useSwitchOrganization`, which is the one
 * place that keeps the switch guard and the cross tab broadcast honest.
 *
 * Used by: routes/_app.tsx.
 */

export type ActiveWorkspaceDecision = "allow" | "wait" | "redirect";

export function decideActiveWorkspace(input: {
	/** Slug from the URL, when the current route is organization scoped. */
	urlSlug?: string;
	/** Slug of the session's active organization, if it is known. */
	activeSlug?: string | null;
	/** Whether the active organization is still loading. */
	activePending: boolean;
}): ActiveWorkspaceDecision {
	// Account settings have no organization scope, so the rule does not apply.
	if (!input.urlSlug) return "allow";

	if (!input.activeSlug) {
		// The active organization is normally one fetch away. Until it arrives
		// the URL organization must not render. If it settles without a slug the
		// session is in a degraded state, so fall back to the old behaviour
		// instead of blocking the app forever.
		return input.activePending ? "wait" : "allow";
	}

	return input.urlSlug === input.activeSlug ? "allow" : "redirect";
}
