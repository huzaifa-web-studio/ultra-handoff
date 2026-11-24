/**
 * Provider adapter selection.
 *
 * Why this file: the resolver picks one adapter for the host and falls back to
 * page metadata. That decision lives in one place.
 *
 * Used by: `lib/link-preview/resolve.ts`.
 */

import {
	arxivMetadata,
	bitbucketMetadata,
	blueskyMetadata,
	doiMetadata,
	githubMetadata,
	gitlabMetadata,
	oembedMetadata,
	packageMetadata,
	stackOverflowMetadata,
} from "./adapters";
import { identifyProvider } from "./identify";
import type { ProviderAdapter, ProviderMetadata } from "./types";

const ADAPTERS: Readonly<Record<string, ProviderAdapter>> = {
	GitHub: githubMetadata,
	GitLab: gitlabMetadata,
	Bitbucket: bitbucketMetadata,
	"Stack Overflow": stackOverflowMetadata,
	Bluesky: blueskyMetadata,
	YouTube: (url) => oembedMetadata("YouTube", url),
	Vimeo: (url) => oembedMetadata("Vimeo", url),
	Loom: (url) => oembedMetadata("Loom", url),
	Spotify: (url) => oembedMetadata("Spotify", url),
	SoundCloud: (url) => oembedMetadata("SoundCloud", url),
	npm: (url) => packageMetadata("npm", url),
	PyPI: (url) => packageMetadata("PyPI", url),
	"crates.io": (url) => packageMetadata("crates.io", url),
	DOI: doiMetadata,
	arXiv: arxivMetadata,
};

/** Resolve the best-effort adapter result for an arbitrary public URL. */
export async function resolveProviderMetadata(
	rawUrl: string,
): Promise<ProviderMetadata | null> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	const provider = identifyProvider(url.hostname);
	if (!provider) return null;
	try {
		const adapter = ADAPTERS[provider];
		return adapter
			? await adapter(url)
			: { provider, kind: "Link", fields: [] };
	} catch {
		// Malformed encoded URLs and provider payloads must not fail the OG fetch.
		return null;
	}
}
