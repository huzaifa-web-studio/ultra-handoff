/**
 * Link URL collection and preview resolution.
 *
 * `collectPreviewUrls` walks a sanitised Plate document and returns the
 * distinct URLs worth previewing. It runs on the sanitised value, so an
 * unknown node shape cannot smuggle a URL in.
 *
 * `resolvePreview` is the whole fetch pipeline for one URL: page, metadata,
 * Open Graph image and icon. Individual asset failures are not fatal. A page
 * with a broken image still produces a title and a description, which is a
 * better card than none.
 *
 * Used by: src/services/link-preview.service.ts and the preview queue.
 */

import { fetchAsset, fetchPage } from "./http";
import { type SniffedImage, sniffImage } from "./images";
import { decodeHtml, parsePageMetadata, resolveAssetUrl } from "./parse";
import {
	canonicalizeUrl,
	hashUrl,
	MAX_PREVIEW_URLS,
	parsePreviewUrl,
	resolvePreviewTarget,
} from "./url";

/** One stored image, ready for the object store. */
export type PreviewAsset = {
	buffer: Buffer;
	image: SniffedImage;
};

/** Everything a card can render, already validated. */
export type PreviewData = {
	title: string;
	description: string;
	siteName: string;
	image: PreviewAsset | null;
	favicon: PreviewAsset | null;
};

/** Outcome of resolving one URL. */
export type ResolveOutcome =
	| { ok: true; canonical: string; urlHash: string; data: PreviewData }
	| {
			ok: false;
			canonical: string;
			urlHash: string;
			code: string;
	  };

/**
 * Collect previewable URLs from a Sanitised Plate value.
 *
 * Both inline links and bookmark blocks carry a `url`, so both feed the same
 * cache. The list is capped: a description with hundreds of links should not
 * turn into hundreds of outbound requests.
 */
export function collectPreviewUrls(value: unknown): string[] {
	const urls = new Set<string>();

	const walk = (node: unknown) => {
		if (!node || typeof node !== "object") return;

		const record = node as Record<string, unknown>;
		const type = record.type;

		if (
			(type === "a" || type === "bookmark") &&
			typeof record.url === "string"
		) {
			const parsed = parsePreviewUrl(record.url);

			if (parsed) {
				urls.add(canonicalizeUrl(parsed));
				if (urls.size >= MAX_PREVIEW_URLS) return;
			}
		}

		const children = record.children;
		if (Array.isArray(children)) {
			for (const child of children) walk(child);
		}
	};

	if (Array.isArray(value)) {
		for (const node of value) walk(node);
	}

	return [...urls].slice(0, MAX_PREVIEW_URLS);
}

/** Turn a fetched asset response into a validated asset, or null. */
async function loadAsset(rawUrl: string): Promise<PreviewAsset | null> {
	const result = await fetchAsset(rawUrl);

	if (!result.ok) return null;

	const image = sniffImage(result.response.body);
	if (!image) return null;

	return { buffer: result.response.body, image };
}

/**
 * Resolve one URL into card data.
 *
 * The page itself must succeed for the row to be `ready`. The image and the
 * icon are best effort, because a site that blocks hotlinking should still
 * produce a usable text card.
 */
export async function resolvePreview(rawUrl: string): Promise<ResolveOutcome> {
	const resolved = await resolvePreviewTarget(rawUrl);

	if (!resolved.ok) {
		// Even a blocked URL needs the same cache key the read side computes,
		// otherwise every save would enqueue it again because the stored row
		// would never be found. `parsePreviewUrl` is DNS free, so it can still
		// canonicalise a blocked host.
		const parsed = parsePreviewUrl(rawUrl);
		const canonical = parsed ? canonicalizeUrl(parsed) : rawUrl.trim();

		return {
			ok: false,
			canonical,
			urlHash: hashUrl(canonical),
			code: resolved.reason,
		};
	}

	const { target } = resolved;
	const page = await fetchPage(target.canonical);

	if (!page.ok) {
		return {
			ok: false,
			canonical: target.canonical,
			urlHash: hashUrl(target.canonical),
			code: page.reason,
		};
	}

	const html = decodeHtml(page.response.body, page.response.contentType);
	const meta = await parsePageMetadata(html);

	// `<base href>` changes how relative URLs resolve on the page, so it takes
	// precedence over the response URL when it is present and valid.
	const base =
		resolveAssetUrl(meta.baseHref, page.response.finalUrl) ??
		page.response.finalUrl;

	const imageUrl = meta.image ? resolveAssetUrl(meta.image, base) : null;
	const iconUrl = meta.favicon
		? resolveAssetUrl(meta.favicon, base)
		: resolveAssetUrl("/favicon.ico", page.response.finalUrl);

	const [image, favicon] = await Promise.all([
		imageUrl ? loadAsset(imageUrl) : Promise.resolve(null),
		iconUrl ? loadAsset(iconUrl) : Promise.resolve(null),
	]);

	return {
		ok: true,
		canonical: target.canonical,
		urlHash: hashUrl(target.canonical),
		data: {
			title: meta.title,
			description: meta.description,
			siteName: meta.siteName,
			image,
			favicon,
		},
	};
}
