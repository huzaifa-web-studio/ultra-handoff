/**
 * Small helpers shared by the link card and the bookmark block.
 *
 * Why these live on the web and not in the API package: the API owns the
 * security decisions (SSRF, storage, sanitising). These are display helpers
 * only, and importing anything from the API at runtime would break the rule
 * that the web bundle has no API runtime dependency.
 *
 * Used by: features/link-previews/link-preview-context.tsx and the editor.
 */

/** True when a href is a page the preview pipeline can talk about. */
export function isPreviewableHref(href: string | undefined): href is string {
	if (!href) return false;

	try {
		const url = new URL(href);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Display host for a URL.
 *
 * `www.` is noise in a card, and the IPv6 brackets are technical. A URL that
 * does not parse returns an empty string rather than throwing during render.
 */
export function displayDomain(href: string | undefined): string {
	if (!href) return "";

	try {
		return new URL(href).hostname
			.replace(/^www\./i, "")
			.replace(/^\[/, "")
			.replace(/\]$/, "");
	} catch {
		return "";
	}
}

/** Matches the server's per document preview cap. */
const MAX_PREVIEW_URLS = 25;

/**
 * Collect the previewable URLs in a Plate document.
 *
 * Both inline links (`a`) and bookmark blocks carry a `url`. The result is
 * sorted and de-duplicated so it can be used directly as a query key.
 *
 * The cap mirrors the server's enqueue limit. Asking about more links than the
 * server will ever resolve would only produce requests that never fill in.
 */
export function extractLinkUrls(value: unknown): string[] {
	const urls = new Set<string>();

	const walk = (node: unknown) => {
		if (!node || typeof node !== "object") return;

		const record = node as Record<string, unknown>;

		if (
			(record.type === "a" || record.type === "bookmark") &&
			typeof record.url === "string" &&
			isPreviewableHref(record.url)
		) {
			urls.add(record.url);
		}

		if (Array.isArray(record.children)) {
			for (const child of record.children) walk(child);
		}
	};

	if (Array.isArray(value)) {
		for (const node of value) walk(node);
	}

	return [...urls].sort().slice(0, MAX_PREVIEW_URLS);
}

/**
 * Shorten a long absolute URL for display without hiding its host.
 *
 * The path is what gets trimmed, because the domain is the part a reader uses
 * to decide whether to trust the link.
 */
export function shortenUrl(href: string, max = 64): string {
	if (href.length <= max) return href;

	try {
		const url = new URL(href);
		const tail = `${url.pathname}${url.search}`;
		const budget = Math.max(8, max - url.hostname.length - 5);

		return `${url.hostname}/${tail.slice(0, budget).replace(/^\//, "")}...`;
	} catch {
		return `${href.slice(0, max - 3)}...`;
	}
}
