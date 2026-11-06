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

import { fetchAsset, fetchPage, fetchResource, MAX_ASSET_BYTES } from "./http";
import { type SniffedImage, sniffImage } from "./images";
import { decodeHtml, parsePageMetadata, resolveAssetUrl } from "./parse";
import {
	identifyProvider,
	parseFigmaCommunityMetadata,
	resolveProviderMetadata,
} from "./providers";
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
	providerData: ProviderPreviewData | null;
};

/** Compact, plain-text provider details rendered by the shared preview card. */
export type ProviderPreviewData = {
	provider: string;
	kind: string;
	fields: { label: string; value: string }[];
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

/** Return a numeric Figma Community file ID from its canonical URL path. */
function figmaCommunityIdFor(url: URL): string | undefined {
	return /^\/community\/file\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
}

/** Figma's public community CDN rejects the identifiable preview-bot agent. */
const FIGMA_PUBLIC_USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
async function loadAsset(
	rawUrl: string,
	userAgent?: string,
): Promise<PreviewAsset | null> {
	const result = await fetchAsset(rawUrl, userAgent ? { userAgent } : {});

	if (!result.ok) return null;

	const image = sniffImage(result.response.body);
	if (!image) return null;

	return { buffer: result.response.body, image };
}

/** Fetch Figma's public thumbnail endpoint with its expected image negotiation. */
async function loadFigmaThumbnail(
	fileId: string,
): Promise<PreviewAsset | null> {
	const result = await fetchResource(
		`https://www.figma.com/community/thumbnail?resource_type=file&resource_id=${fileId}&width=800`,
		{
			maxBytes: MAX_ASSET_BYTES,
			acceptContentTypes: ["image/"],
			accept: "image/*",
			userAgent: FIGMA_PUBLIC_USER_AGENT,
		},
	);
	if (!result.ok) return null;

	const image = sniffImage(result.response.body);
	return image ? { buffer: result.response.body, image } : null;
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
	const figmaUserAgent =
		identifyProvider(target.url.hostname) === "Figma"
			? FIGMA_PUBLIC_USER_AGENT
			: undefined;
	// Provider lookups are best effort. The hardened OG fetch remains the
	// universal fallback and is always performed through the same SSRF guard.
	const baseProviderData =
		(await resolveProviderMetadata(target.canonical)) ??
		(() => {
			const provider = identifyProvider(target.url.hostname);
			const isFigmaCommunityFile =
				provider === "Figma" &&
				/^\/community\/file\/\d+(?:\/|$)/.test(target.url.pathname);
			return provider
				? {
						provider,
						kind: isFigmaCommunityFile ? "Community file" : "Link",
						fields: [],
					}
				: null;
		})();
	const page = await fetchPage(target.canonical);

	if (!page.ok && !figmaCommunityIdFor(target.url)) {
		return {
			ok: false,
			canonical: target.canonical,
			urlHash: hashUrl(target.canonical),
			code: page.reason,
		};
	}

	const html = page.ok
		? decodeHtml(page.response.body, page.response.contentType)
		: "";
	const meta = page.ok
		? await parsePageMetadata(html)
		: {
				title: "",
				description: "",
				siteName: "",
				image: "",
				favicon: "",
				baseHref: "",
			};
	const providerData =
		baseProviderData?.provider === "Figma" && html
			? (parseFigmaCommunityMetadata(html) ?? baseProviderData)
			: baseProviderData;

	// `<base href>` changes how relative URLs resolve on the page, so it takes
	// precedence over the response URL when it is present and valid.
	const base =
		resolveAssetUrl(
			meta.baseHref,
			page.ok ? page.response.finalUrl : target.canonical,
		) ?? (page.ok ? page.response.finalUrl : target.canonical);

	const figmaCommunityId =
		baseProviderData?.provider === "Figma"
			? figmaCommunityIdFor(target.url)
			: undefined;
	const imageUrl = meta.image
		? resolveAssetUrl(meta.image, base)
		: figmaCommunityId
			? `https://www.figma.com/community/thumbnail?resource_type=file&resource_id=${figmaCommunityId}&width=800`
			: null;
	const iconUrl = meta.favicon
		? resolveAssetUrl(meta.favicon, base)
		: baseProviderData?.provider === "Figma"
			? "https://static.figma.com/app/icon/1/favicon.png"
			: resolveAssetUrl(
					"/favicon.ico",
					page.ok ? page.response.finalUrl : target.canonical,
				);

	let [image, favicon] = await Promise.all([
		imageUrl ? loadAsset(imageUrl, figmaUserAgent) : Promise.resolve(null),
		iconUrl ? loadAsset(iconUrl, figmaUserAgent) : Promise.resolve(null),
	]);
	if (!image && figmaCommunityId) {
		image = await loadFigmaThumbnail(figmaCommunityId);
	}
	if (baseProviderData?.provider === "Figma")
		favicon ??= await loadAsset(
			"https://static.figma.com/app/icon/1/favicon.png",
			figmaUserAgent,
		);
	const slugTitle = target.url.pathname
		.split("/")
		.filter(Boolean)
		.at(-1)
		?.replace(/-[a-f0-9]{8,}$/i, "")
		.replace(/[-_]+/g, " ")
		.trim();

	return {
		ok: true,
		canonical: target.canonical,
		urlHash: hashUrl(target.canonical),
		data: {
			title:
				meta.title ||
				(figmaCommunityId ? (slugTitle ?? "Figma Community file") : ""),
			description: meta.description,
			siteName:
				meta.siteName ||
				(baseProviderData?.provider === "Figma" ? "Figma Community" : ""),
			image,
			favicon,
			providerData:
				providerData?.provider === "Figma" && figmaCommunityId
					? { ...providerData, kind: "Community file" }
					: providerData,
		},
	};
}
