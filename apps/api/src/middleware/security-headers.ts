/**
 * Security headers for every API response.
 *
 * Why one global policy: the API is fetched by the web app from another origin
 * and several routes carry user influenced data, so the headers must not drift
 * per route. `/files/*` is the one exception: it sets a stricter, sandboxed CSP
 * on its own Response, so this middleware leaves that header alone there
 * instead of overwriting it.
 *
 * The CSP is skipped in development because the OpenAPI and Bull Board pages
 * are HTML with their own inline assets and only exist there.
 *
 * `Referrer-Policy: no-referrer` matters because file and invitation URLs are
 * capability URLs. Nothing about the API should ever travel in a Referer.
 *
 * Used by: src/index.ts.
 */

import { Elysia } from "elysia";

import { isDevelopment } from "../lib/env";

/** No API response may leak its address through a Referer. */
const REFERRER_POLICY = "no-referrer";

/**
 * A JSON API loads nothing, so every fetch directive is denied.
 *
 * `frame-ancestors` blocks clickjacking and pairs with the legacy
 * `X-Frame-Options` header for older browsers.
 */
const API_CONTENT_SECURITY_POLICY =
	"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export const securityHeaders = new Elysia({ name: "security-headers" })
	.onRequest(({ request, set }) => {
		set.headers["referrer-policy"] = REFERRER_POLICY;
		set.headers["x-frame-options"] = "DENY";
		set.headers["x-content-type-options"] = "nosniff";

		if (isDevelopment) return;

		/*
		 * `/files/*` returns a Response with its own CSP (`sandbox`, no
		 * styles). Elysia merges `set.headers` over a returned Response, so
		 * setting a policy here would replace the stricter one.
		 */
		const { pathname } = new URL(request.url);

		if (pathname.startsWith("/files/")) return;

		set.headers["content-security-policy"] = API_CONTENT_SECURITY_POLICY;
	})
	.as("global");
