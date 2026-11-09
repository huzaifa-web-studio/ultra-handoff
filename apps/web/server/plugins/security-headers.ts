/**
 * Applies the shell security headers at the Nitro edge.
 *
 * Why a Nitro runtime plugin and not a `handlers` middleware: Nitro runs the
 * static file middleware first, and it returns a Response for every asset, so
 * a later handler middleware would never see the shell or the bundles. The
 * `response` hook runs for every response, static ones included.
 *
 * Production fails to boot when the API or storage origin is missing. A CSP
 * that silently drops one of them would block sign in, uploads or the realtime
 * stream, which is far harder to diagnose than a startup error.
 *
 * Used by: vite.config.ts, through the `nitro({ plugins: [...] })` option.
 */

import { definePlugin } from "nitro";

import { buildSecurityHeaders } from "../security-headers";

/**
 * The production build prerenders the SPA shell through a temporary preview
 * server. That server runs in the same process with `NODE_ENV=production`, so
 * it must not demand the deployment's storage origin. The real server does.
 */
const isPrerendering = process.env.TSS_PRERENDERING === "true";

/** The app is only in "production" mode inside a deployed bundle. */
const isProduction =
	process.env.NODE_ENV === "production" && !isPrerendering;

/** Read a required public origin, or explain exactly what is missing. */
function requiredOrigin(name: string): string {
	const value = process.env[name]?.trim();

	if (!value) {
		throw new Error(
			`${name} is required in production. The Content-Security-Policy needs every origin the browser talks to, so the shell cannot start without it.`,
		);
	}

	return value;
}

const headers = buildSecurityHeaders({
	apiOrigin: isProduction
		? requiredOrigin("VITE_API_URL")
		: process.env.VITE_API_URL,
	storageOrigin: isProduction
		? requiredOrigin("S3_PUBLIC_ENDPOINT")
		: process.env.S3_PUBLIC_ENDPOINT,
	includeContentSecurityPolicy: isProduction,
});

export default definePlugin((nitroApp) => {
	nitroApp.hooks.hook("response", (response) => {
		for (const [name, value] of Object.entries(headers)) {
			// Never override a header a route already set. The API does this for
			// `/files`, and Nitro itself sets caching headers.
			if (!response.headers.has(name)) response.headers.set(name, value);
		}
	});
});
