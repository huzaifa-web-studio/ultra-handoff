/**
 * Public file reads.
 *
 * Why proxy through the API: the SeaweedFS bucket is private and the S3
 * gateway is not exposed in production. Serving verified objects here keeps
 * storage internal while still giving `user.image` a stable URL.
 *
 * Access control: object keys contain a random UUID and only the allowlisted
 * public prefixes are readable. Private prefixes added later (contracts,
 * invoices) stay hidden until explicitly opted in.
 *
 * Used by: src/index.ts. Referenced by `objectUrl()` as `/files/<key>`.
 */

import { Elysia } from "elysia";

import { isNotFoundError, openObject } from "../lib/storage";
import { isPublicFileKey } from "../lib/storage/config";

export const fileRoutes = new Elysia().get(
	"/files/*",
	async ({ params, status }) => {
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

		if (!isPublicFileKey(key)) {
			return status(404);
		}

		try {
			const object = await openObject(key);

			return new Response(object.body, {
				headers: {
					"Content-Type": object.contentType ?? "application/octet-stream",
					...(object.contentLength
						? { "Content-Length": String(object.contentLength) }
						: {}),
					...(object.etag ? { ETag: object.etag } : {}),
					// Keys are content addressed by a UUID, so the bytes behind a
					// URL never change and the response can be cached forever.
					"Cache-Control": "public, max-age=31536000, immutable",
					// The served types are images, but nosniff removes any chance
					// of a browser treating a mislabelled object as HTML.
					"X-Content-Type-Options": "nosniff",
				},
			});
		} catch (error) {
			if (isNotFoundError(error)) {
				return status(404);
			}

			return status(500);
		}
	},
);
