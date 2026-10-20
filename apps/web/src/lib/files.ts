/**
 * Asset URL resolution.
 *
 * Why: the API stores images as root relative paths such as
 * `/files/avatars/<user>/<id>.png`. That keeps the database portable if the API
 * origin changes, but an `<img>` in the web app needs an absolute URL when the
 * API lives on another port or subdomain.
 *
 * External URLs (for example a Google profile photo) are passed through
 * untouched.
 *
 * Used by: src/components/user-avatar.tsx.
 */

import { API_ORIGIN } from "./api";

export function resolveAssetUrl(src?: string | null): string | undefined {
	if (!src) return undefined;

	if (src.startsWith("/files/")) {
		return `${API_ORIGIN}${src}`;
	}

	return src;
}
