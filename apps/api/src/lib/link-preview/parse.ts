/**
 * HTML metadata extraction for link previews.
 *
 * Why parse ourselves instead of storing the remote HTML: the browser must
 * never receive markup from a third party. We read a small allowlist of tags
 * and keep plain strings, so React can render them as text and there is no
 * HTML injection path at all.
 *
 * Bun ships `HTMLRewriter`, so this needs no parser dependency and streams the
 * document instead of building a DOM.
 *
 * Charset handling is explicit: plenty of sites still serve windows-1252 or
 * Shift_JIS, and decoding those as UTF-8 produces mojibake in the card. The
 * charset comes from the response header first, then from a `<meta>` sniff,
 * then falls back to UTF-8.
 *
 * Used by: src/lib/link-preview/metadata.ts.
 */

/** Longest title kept. Cards clamp visually as well. */
const MAX_TITLE = 300;

/** Longest description kept. */
const MAX_DESCRIPTION = 600;

/** Longest site name kept. */
const MAX_SITE_NAME = 120;

/** Characters that must never reach the UI: controls and bidi overrides. */
const UNSAFE_TEXT =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control and bidi characters is the purpose of this expression.
	/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Entities that appear in meta tags often enough to decode by hand. */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	apos: "'",
	gt: ">",
	lt: "<",
	nbsp: " ",
	quot: '"',
};

/**
 * Decode the HTML entities that survive attribute parsing.
 *
 * `HTMLRewriter` returns attribute values verbatim, so a title written as
 * `GitHub&#39;s` arrives with the entity intact. React would escape the
 * ampersand and the card would show the raw code. Only numeric entities and
 * the handful above are decoded; an unknown entity is left alone, which is the
 * safe default.
 */
function decodeEntities(value: string): string {
	return value.replace(
		/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi,
		(match, entity: string) => {
			if (entity.startsWith("#")) {
				const hex = entity[1]?.toLowerCase() === "x";
				const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);

				if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
					return match;
				}

				try {
					return String.fromCodePoint(code);
				} catch {
					return match;
				}
			}

			return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
		},
	);
}

/** Normalise one piece of metadata into something safe to render. */
export function cleanText(
	value: string | null | undefined,
	max: number,
): string {
	if (typeof value !== "string") return "";

	const cleaned = decodeEntities(value)
		.replace(UNSAFE_TEXT, " ")
		.replace(/\s+/g, " ")
		.trim();

	return cleaned.slice(0, max);
}

/**
 * Decode the response body using the declared charset.
 *
 * `TextDecoder` throws on an unknown label, which a hostile page can declare.
 * That is not an error worth failing the whole preview for, so it falls back
 * to UTF-8.
 */
export function decodeHtml(body: Buffer, contentType: string): string {
	const headerCharset = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1];

	// Browsers sniff the first 1024 bytes for a meta charset. Doing the same
	// keeps a page without a header readable.
	const head = body.subarray(0, 1024).toString("latin1");
	const metaCharset =
		/<meta[^>]+charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(head)?.[1] ??
		/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9_-]+)/i.exec(
			head,
		)?.[1];

	const label = (headerCharset ?? metaCharset ?? "utf-8").toLowerCase();

	try {
		return new TextDecoder(
			label as ConstructorParameters<typeof TextDecoder>[0],
		).decode(body);
	} catch {
		return new TextDecoder("utf-8").decode(body);
	}
}

/** Raw metadata before normalisation and URL resolution. */
export type RawMetadata = {
	title: string;
	description: string;
	siteName: string;
	image: string;
	favicon: string;
	baseHref: string;
};

/**
 * Read the allowlisted tags out of a page head.
 *
 * Repeats are resolved by precedence, not by document order: Open Graph first,
 * then Twitter cards, then plain HTML metadata. That is the order that
 * produces the intended card on sites that set both.
 */
export async function parsePageMetadata(html: string): Promise<RawMetadata> {
	const meta = new Map<string, string>();
	const icons: { rel: string; href: string }[] = [];
	let title = "";
	let baseHref = "";

	const rewriter = new HTMLRewriter()
		.on("title", {
			text(chunk) {
				title += chunk.text;
			},
		})
		.on("base", {
			element(element) {
				const href = element.getAttribute("href");
				if (!href || baseHref.length > 0) return;
				baseHref = href;
			},
		})
		.on("meta", {
			element(element) {
				const key = (
					element.getAttribute("property") ??
					element.getAttribute("name") ??
					""
				)
					.trim()
					.toLowerCase();
				const content = element.getAttribute("content");

				if (!key || content === null) return;
				// First value wins, which keeps the most specific tag when a
				// page repeats one by mistake.
				if (!meta.has(key)) meta.set(key, content);
			},
		})
		.on("link", {
			element(element) {
				const rel = (element.getAttribute("rel") ?? "").toLowerCase();
				const href = element.getAttribute("href");

				if (!href) return;
				if (
					rel.includes("icon") ||
					rel.includes("apple-touch-icon") ||
					rel.includes("mask-icon")
				) {
					icons.push({ rel, href });
				}
			},
		});

	// Driving the rewriter with a Response is the supported entry point. The
	// returned text is the rewritten document, which we do not need.
	await rewriter.transform(new Response(html)).text();

	const pick = (...keys: string[]): string => {
		for (const key of keys) {
			const value = meta.get(key);
			if (value && value.trim().length > 0) return value;
		}
		return "";
	};

	// Prefer a raster icon. SVG icons are rejected later by the image sniffer,
	// so choosing one here would waste a fetch and end with no icon at all.
	const icon =
		icons.find((entry) => !entry.href.includes(".svg")) ??
		icons.find((entry) => entry.rel.includes("icon")) ??
		icons.find((entry) => entry.rel.includes("apple-touch-icon"));

	return {
		title: cleanText(pick("og:title", "twitter:title") || title, MAX_TITLE),
		description: cleanText(
			pick("og:description", "twitter:description", "description"),
			MAX_DESCRIPTION,
		),
		siteName: cleanText(
			pick("og:site_name", "application-name", "twitter:site"),
			MAX_SITE_NAME,
		),
		image: pick(
			"og:image:secure_url",
			"og:image",
			"twitter:image",
			"twitter:image:src",
		),
		favicon: icon?.href ?? "",
		baseHref,
	};
}

/**
 * Turn a possibly relative URL into an absolute one.
 *
 * Relative image and icon paths are the norm, and `data:`, `blob:` and
 * `javascript:` values are never useful here, so they are dropped instead of
 * being handed to the fetcher.
 */
export function resolveAssetUrl(value: string, base: string): string | null {
	const trimmed = value.trim();

	if (trimmed.length === 0) return null;
	if (trimmed.startsWith("data:")) return null;
	if (trimmed.startsWith("blob:")) return null;
	if (trimmed.startsWith("javascript:")) return null;

	try {
		return new URL(trimmed, base).toString();
	} catch {
		return null;
	}
}
