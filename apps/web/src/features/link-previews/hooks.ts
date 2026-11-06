"use client";

/**
 * Query hook for link previews.
 *
 * Why the retry window: a link a writer just added has no row until the
 * background worker finishes, so the first read returns nothing. Polling a few
 * times, then stopping, lets the card fill itself in without turning the
 * editor into an infinite poller.
 *
 * Used by: features/link-previews/link-preview-context.tsx.
 */

import { useQuery } from "@tanstack/react-query";

import { fetchLinkPreviews, type LinkPreviewMap } from "./api";

/** How often a missing preview is retried, in milliseconds. */
const PENDING_POLL_MS = 1_200;

/** How many reads happen before the editor accepts that a preview is missing. */
const MAX_PENDING_POLLS = 12;

/** Stable query key, so two editors asking about the same URLs share a request. */
function previewsKey(orgSlug: string, urls: string[]) {
	return ["link-previews", orgSlug, urls] as const;
}

/**
 * Read the previews for a set of URLs.
 *
 * `urls` must be sorted and de-duplicated by the caller. That keeps the query
 * key stable across renders, so typing text around a link does not refetch.
 */
export function useLinkPreviews(orgSlug: string, urls: string[]) {
	return useQuery<LinkPreviewMap>({
		queryKey: previewsKey(orgSlug, urls),
		queryFn: () => fetchLinkPreviews(orgSlug, urls),
		enabled: Boolean(orgSlug) && urls.length > 0,
		// A preview changes at most once every 30 days, so the client can trust
		// a successful answer for a long time.
		staleTime: 10 * 60_000,
		retry: 1,
		refetchInterval: (query) => {
			const data = query.state.data;

			if (!data) return PENDING_POLL_MS;

			const missing = urls.some((url) => !data[url]);
			const polls = query.state.dataUpdateCount;

			return missing && polls < MAX_PENDING_POLLS ? PENDING_POLL_MS : false;
		},
	});
}
