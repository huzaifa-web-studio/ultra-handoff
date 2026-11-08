/**
 * File reads.
 *
 * Why proxy through the API: the SeaweedFS bucket is private and the S3
 * gateway is not exposed in production. Serving verified objects here keeps
 * storage internal while still giving `user.image` a stable URL.
 *
 * Access control: every key is classified by `fileKeyAccess`.
 *   - avatars, organization logos and project logos stay public, because they
 *     are branding shown outside a session (invitation cards, sign-in).
 *   - milestone and comment attachments require a session plus membership of
 *     the organization named in the key. A key carries a random UUID, so the
 *     organization id is the only trustworthy owner signal it has.
 *
 * The private response is `no-store`, which is what makes a delete actually
 * revoke access. The public response keeps the immutable cache, because the
 * bytes behind a UUID key never change.
 *
 * Used by: src/index.ts. Referenced by `objectUrl()` as `/files/<key>`.
 */

import { Elysia } from "elysia";

import {
	fileKeyAccess,
	isNotFoundError,
	openObject,
	safeDownloadName,
} from "../lib/storage";
import { TimeoutError } from "../lib/timeout";
import { isOrganizationMember } from "../middleware/tenant";

/** Prefixes whose objects are downloads rather than inline content. */
const ATTACHMENT_SEGMENTS = ["/comments/files/", "/milestones/files/"];

/**
 * Build a `Content-Disposition` value.
 *
 * The ASCII fallback keeps older clients happy. `filename*` carries the real
 * UTF-8 name, which the sanitizer has already stripped of quotes, control
 * characters and path separators.
 */
function contentDisposition(download: boolean, name: string | null): string {
	const disposition = download ? "attachment" : "inline";
	if (!name) return disposition;

	// Non-ASCII characters are not valid in a quoted header value. Keep an
	// ASCII-only fallback and put the full name in the RFC 5987 parameter.
	const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");

	return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const fileRoutes = new Elysia().get(
	"/files/*",
	async ({ params, request, status }) => {
		let key: string;

		try {
			// Wildcard params normally arrive without a leading slash, but strip
			// any that do so the key check is not fooled by `/avatars/...`.
			key = decodeURIComponent(params["*"] ?? "").replace(/^\/+/, "");
		} catch {
			// Malformed percent encoding must not reach the storage client.
			return status(404);
		}

		// Keys are generated from a UUID, so any traversal sequence is a
		// malformed request rather than a real object.
		if (!key || key.includes("..") || key.includes("//")) {
			return status(404);
		}

		const access = fileKeyAccess(key);
		if (!access) {
			return status(404);
		}

		// Unauthenticated, unverified and cross-organization callers all get the
		// same 404, so the route cannot be used to learn that an organization
		// exists or that a key is real.
		if (
			access.visibility === "organization" &&
			!(await isOrganizationMember(request.headers, access.organizationId))
		) {
			return status(404);
		}

		const url = new URL(request.url);
		const isAttachment = ATTACHMENT_SEGMENTS.some((segment) =>
			key.includes(segment),
		);
		const download = url.searchParams.get("download") === "1" || isAttachment;
		const name = download
			? safeDownloadName(url.searchParams.get("name"))
			: null;

		try {
			const object = await openObject(key);

			return new Response(object.body, {
				headers: {
					"Content-Type": object.contentType ?? "application/octet-stream",
					...(object.contentLength
						? { "Content-Length": String(object.contentLength) }
						: {}),
					...(object.etag ? { ETag: object.etag } : {}),
					// Public branding is content addressed by a UUID, so it can be
					// cached forever. Client attachments must not be cached, so a
					// delete removes access immediately.
					"Cache-Control":
						access.visibility === "public"
							? "public, max-age=31536000, immutable"
							: "private, no-store",
					// nosniff removes any chance of a browser treating a
					// mislabelled object as HTML.
					"X-Content-Type-Options": "nosniff",
					// Belt and braces for the same concern. Anything fetched from
					// this route is attacker influenced, so the response cannot
					// run a script even if a browser disagreed with the type.
					"Content-Disposition": contentDisposition(download, name),
					"Content-Security-Policy":
						"default-src 'none'; style-src 'none'; sandbox",
					"Cross-Origin-Resource-Policy": "same-site",
				},
			});
		} catch (error) {
			if (isNotFoundError(error)) {
				return status(404);
			}

			// A deadline means the storage gateway accepted the call and never
			// answered. That is an upstream timeout, not a bug in this route.
			if (error instanceof TimeoutError) {
				return status(504);
			}

			return status(500);
		}
	},
);
