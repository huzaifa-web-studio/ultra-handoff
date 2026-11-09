/**
 * Security headers for the SPA shell.
 *
 * Why a separate module: the same policy is applied by the Nitro runtime plugin
 * in a built bundle and by Vite's development server locally, so it cannot live
 * inside either one of them.
 *
 * The Content-Security-Policy lists every origin the browser actually talks to:
 *
 *   - the API, for Eden Treaty, Better Auth and the realtime socket,
 *   - the presigned storage endpoint, because uploads PUT straight to it,
 *   - Google Fonts, for the two families imported by global.css.
 *
 * Inline script and style stay allowed on purpose: the TanStack SPA shell
 * carries inline bootstrap scripts, React writes style attributes, and a static
 * shell cannot carry a per-request nonce. Everything else stays closed, notably
 * `object-src`, `frame-ancestors` and the origin allow lists.
 *
 * Used by: server/plugins/security-headers.ts and vite.config.ts.
 */

export type SecurityHeaderOptions = {
	/** Public API origin, for example `https://api.example.com`. */
	apiOrigin?: string;
	/** Browser reachable object storage origin used for presigned uploads. */
	storageOrigin?: string;
	/**
	 * Whether to emit the Content-Security-Policy.
	 *
	 * Disabled for local development, where HMR needs a websocket to the dev
	 * server and Vite injects its own inline modules.
	 */
	includeContentSecurityPolicy: boolean;
};

/** Turn an origin into the matching websocket origin, or null when invalid. */
function websocketOrigin(apiOrigin: string): string | null {
	try {
		const url = new URL(apiOrigin);
		const protocol = url.protocol === "https:" ? "wss:" : "ws:";

		return `${protocol}//${url.host}`;
	} catch {
		return null;
	}
}

/** Trailing slashes in a configured origin would produce `//` in a CSP source. */
function trimOrigin(value: string | undefined): string | undefined {
	const trimmed = value?.trim().replace(/\/+$/, "");

	return trimmed ? trimmed : undefined;
}

/**
 * Build the header set for the app shell.
 *
 * Exported for tests, so the policy can be checked without a running Nitro
 * server or a production build.
 */
export function buildSecurityHeaders(
	options: SecurityHeaderOptions,
): Record<string, string> {
	const headers: Record<string, string> = {
		"Referrer-Policy": "same-origin",
		"X-Frame-Options": "DENY",
		"X-Content-Type-Options": "nosniff",
		"Cross-Origin-Opener-Policy": "same-origin",
	};

	if (!options.includeContentSecurityPolicy) return headers;

	const apiOrigin = trimOrigin(options.apiOrigin);
	const storageOrigin = trimOrigin(options.storageOrigin);
	const connectSources = ["'self'"];

	if (apiOrigin) {
		connectSources.push(apiOrigin);

		// `connect-src https://api...` does not cover `wss://api...`.
		const socket = websocketOrigin(apiOrigin);

		if (socket) connectSources.push(socket);
	}

	if (storageOrigin) connectSources.push(storageOrigin);

	const apiSource = apiOrigin ? ` ${apiOrigin}` : "";

	headers["Content-Security-Policy"] = [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"font-src 'self' data: https://fonts.gstatic.com",
		// `https:` covers OAuth profile photos, which are external URLs.
		`img-src 'self' data: blob: https:${apiSource}`,
		`media-src 'self' blob:${apiSource}`,
		`connect-src ${connectSources.join(" ")}`,
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	].join("; ");

	return headers;
}
