/**
 * Typed Eden calls for link previews.
 *
 * Why a feature API module: the editor must never call `api` directly. The
 * request shape and the error conversion live here, so the route can change
 * without touching the card components.
 *
 * The endpoint only reads cached rows. It never asks the API to fetch a URL,
 * which is what keeps a hover from causing outbound traffic.
 *
 * Used by: features/link-previews/hooks.ts.
 */

import { ApiRequestError, api, readApiError } from "#/lib/api";

/** One resolved preview, as the card renders it. */
export type LinkPreview = {
	url: string;
	status: "pending" | "ready" | "unavailable" | "blocked";
	title: string | null;
	description: string | null;
	siteName: string | null;
	/** Our own `/files/...` URL, never a remote image. */
	imageUrl: string | null;
	imageWidth: number | null;
	imageHeight: number | null;
	faviconUrl: string | null;
	providerData: {
		provider: string;
		kind: string;
		fields: { label: string; value: string }[];
	} | null;
	domain: string;
	fetchedAt: string | null;
};

/** Previews keyed by the exact URL the editor asked about. */
export type LinkPreviewMap = Record<string, LinkPreview>;

/**
 * Ask for the previews of a set of URLs.
 *
 * An empty list short circuits, so a document with no links makes no request.
 */
export async function fetchLinkPreviews(
	orgSlug: string,
	urls: string[],
): Promise<LinkPreviewMap> {
	if (urls.length === 0) return {};

	const response = await api
		.orgs({ orgSlug })
		["link-previews"].post({ urls: urls.slice(0, 50) });

	if (response.error) {
		throw new ApiRequestError(
			readApiError(response.error, "Could not load link previews."),
			0,
		);
	}

	return response.data?.previews ?? {};
}
