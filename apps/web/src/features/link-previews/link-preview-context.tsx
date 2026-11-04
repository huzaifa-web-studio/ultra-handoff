"use client";

/**
 * Link preview data for one editor.
 *
 * Why a context instead of props: link nodes are rendered deep inside Plate by
 * the plugin registry, so there is no prop path from the milestone pane to a
 * link. A context keeps the query in one place and lets every link ask for its
 * own entry by href.
 *
 * The provider is mounted by the milestone editor for both the editable and
 * the read only surface, so a client sees exactly the same cards as staff.
 *
 * Used by: features/milestones/editor/milestone-editor.tsx.
 */

import { createContext, type ReactNode, useContext } from "react";

import type { LinkPreview, LinkPreviewMap } from "./api";
import { useLinkPreviews } from "./hooks";

/** An empty map, stable across renders so consumers do not re-render. */
const EMPTY: LinkPreviewMap = {};

const LinkPreviewContext = createContext<LinkPreviewMap>(EMPTY);

/** Read the card data for one href, if it has been resolved yet. */
export function useLinkPreview(
	href: string | undefined,
): LinkPreview | undefined {
	const previews = useContext(LinkPreviewContext);

	if (!href) return undefined;

	return previews[href];
}

/**
 * Load previews for a document and expose them to every link below it.
 *
 * `urls` must be the sorted, de-duplicated set from `extractLinkUrls`. The
 * editor owns that list because it owns the document value.
 */
export function LinkPreviewProvider({
	orgSlug,
	urls,
	children,
}: {
	orgSlug: string;
	urls: string[];
	children: ReactNode;
}) {
	const { data } = useLinkPreviews(orgSlug, urls);

	return (
		<LinkPreviewContext.Provider value={data ?? EMPTY}>
			{children}
		</LinkPreviewContext.Provider>
	);
}
