/**
 * Link preview routes.
 *
 * Why a POST for a read: the client asks about a set of URLs at once, and a
 * query string would hit length limits and leak every URL into access logs.
 * The route only reads cached rows. It never fetches anything, which is what
 * keeps it safe to call from the editor.
 *
 * Used by: src/index.ts.
 */

import { Elysia, t } from "elysia";

import { authErrorMessage, authErrorStatus } from "../lib/auth-error";
import { MAX_PREVIEW_URL_LENGTH } from "../lib/link-preview/url";
import { tenantPlugin } from "../middleware/tenant";
import {
	MAX_READ_URLS,
	readLinkPreviews,
} from "../services/link-preview.service";

/** Params for a tenant scoped route. */
const tenantParams = t.Object({
	orgSlug: t.String({ minLength: 1, maxLength: 255 }),
});

export const linkPreviewRoutes = new Elysia({ name: "link-previews" })
	.use(tenantPlugin)
	/**
	 * Return the previews that already exist for these URLs.
	 *
	 * Unknown URLs are omitted rather than reported as missing, so the client
	 * can render a compact card without treating it as an error.
	 */
	.post(
		"/orgs/:orgSlug/link-previews",
		async ({ tenant, status, body }) => {
			try {
				return {
					previews: await readLinkPreviews(tenant, body.urls),
				};
			} catch (error) {
				return status(authErrorStatus(error), {
					message: authErrorMessage(error, "Could not load link previews."),
				});
			}
		},
		{
			tenant: true,
			params: tenantParams,
			body: t.Object({
				urls: t.Array(t.String({ maxLength: MAX_PREVIEW_URL_LENGTH }), {
					maxItems: MAX_READ_URLS,
				}),
			}),
		},
	);
