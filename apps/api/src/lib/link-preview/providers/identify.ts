/**
 * Provider host identification.
 *
 * Why this file: the host lookup is the one rule that decides which brand label
 * a preview gets, even when the page only exposes Open Graph tags.
 *
 * Used by: `resolve.ts`.
 */

import { PROVIDERS } from "./types";
export function identifyProvider(hostname: string): string | null {
	const host = hostname.toLowerCase().replace(/^www\./, "");
	return (
		PROVIDERS.find(({ hosts }) =>
			hosts.some((domain) => host === domain || host.endsWith(`.${domain}`)),
		)?.name ?? null
	);
}

/** Extract fields Figma publishes in a community file's JSON-LD graph. */
