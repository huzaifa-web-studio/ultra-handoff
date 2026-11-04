/**
 * URL parsing and SSRF guard for link previews.
 *
 * Why this file exists: a link preview means fetching a URL chosen by a user
 * from inside our own network. That is the classic SSRF shape, so the rules
 * are an allowlist applied before any socket is opened:
 *
 *   - http and https only
 *   - port 80 or 443 only
 *   - no credentials in the URL
 *   - no single label host names (intranet, docker service names)
 *   - every resolved address must be public, not just the first one
 *
 * The address check uses `net.BlockList` rather than string prefixes, because
 * IPv4 has several textual forms and IPv6 has mapped, NAT64 and 6to4 forms.
 * `net.BlockList` compares parsed addresses, so `2130706433` and
 * `::ffff:7f00:1` are both caught.
 *
 * Important runtime note: validating the host name and then calling `fetch`
 * is not enough. Bun ignores the `lookup` option on `node:https`, so the stack
 * would re-resolve and a DNS rebinding attack could reach a private address.
 * This file only produces targets; the fetcher pins the socket to
 * `addresses[0]` and re-validates every redirect.
 *
 * Used by: src/lib/link-preview/http.ts and the preview service.
 */

import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";

/** Longest URL accepted for a preview. Longer values are real links, not pages. */
export const MAX_PREVIEW_URL_LENGTH = 2048;

/** Most distinct URLs one document may ask to preview. */
export const MAX_PREVIEW_URLS = 25;

/**
 * How long a host name may take to resolve.
 *
 * Why a timeout: `dns.lookup` has no bounded deadline, and on a broken or
 * overloaded resolver it can hang for minutes. Without this, one bad host name
 * would hold a worker slot open indefinitely.
 */
const DNS_TIMEOUT_MS = 3_000;

/** Protocols a preview may use. Mirrors the stored link allowlist. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Default port per protocol. */
const DEFAULT_PORTS: Record<string, number> = {
	"http:": 80,
	"https:": 443,
};

/**
 * Host name suffixes that never resolve to a public service.
 *
 * These are checked at the string level as well as after DNS, because
 * `localhost` may resolve to a public answer on a misconfigured resolver and
 * the intent is still local.
 */
const BLOCKED_HOST_SUFFIXES = [
	".localhost",
	".local",
	".internal",
	".intranet",
	".lan",
	".home.arpa",
	".corp",
	".onion",
	".i2p",
];

/**
 * Every IPv4 and IPv6 range that is not a public unicast destination.
 *
 * Sources: RFC 6890 special purpose ranges, the IPv4 multicast and reserved
 * blocks, and the IPv6 unique local, link local, documentation and transition
 * ranges. The final entry blocks the whole IPv4-mapped IPv6 space, because a
 * mapped address is only ever a way to spell an IPv4 address.
 */
const privateRanges = new net.BlockList();

for (const [net_, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	privateRanges.addSubnet(net_, prefix, "ipv4");
}

for (const [net_, prefix] of [
	["::", 128],
	["::1", 128],
	["64:ff9b::", 96],
	["100::", 64],
	["2001:db8::", 32],
	["2002::", 16],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	privateRanges.addSubnet(net_, prefix, "ipv6");
}

/** One address the fetcher may connect to. */
export type ResolvedAddress = {
	address: string;
	family: 4 | 6;
};

/** A URL that passed the allowlist and resolved to public addresses only. */
export type PreviewTarget = {
	url: URL;
	/** Cache key form: fragment dropped, host lowercased, default port removed. */
	canonical: string;
	hostname: string;
	port: number;
	/** Every resolved address is public. The fetcher tries them in order. */
	addresses: ResolvedAddress[];
};

/** Why a URL cannot be previewed. Never shown to the user verbatim. */
export type PreviewUrlError = "unsupported" | "blocked";

/** Result of parsing and resolving one URL. */
export type PreviewTargetResult =
	| { ok: true; target: PreviewTarget }
	| { ok: false; reason: PreviewUrlError };

/** Lowercase a host name and drop the trailing dot that FQDN form allows. */
export function normalizeHostname(hostname: string): string {
	return hostname.trim().toLowerCase().replace(/\.+$/, "");
}

/** Strip the brackets from an IPv6 literal so `net.isIP` accepts it. */
function unbracket(hostname: string): string {
	return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Extract the IPv4 address embedded in an IPv4-mapped IPv6 address.
 *
 * Why not just add `::ffff:0:0/96` to the blocklist: Bun's `net.BlockList`
 * matches plain IPv4 addresses against that subnet, which blocks the entire
 * public internet. The mapped form is therefore unwrapped and checked against
 * the IPv4 ranges explicitly.
 *
 * Both spellings occur: `dns.lookup` and `URL` normalise `::ffff:127.0.0.1`
 * to `::ffff:7f00:1`, while a manually written value keeps the dotted form.
 */
function mappedIpv4(address: string): string | null {
	const clean = address.split("%")[0]?.toLowerCase() ?? "";

	if (!clean.startsWith("::ffff:")) return null;

	const rest = clean.slice("::ffff:".length);

	if (net.isIPv4(rest)) return rest;

	const groups = rest.split(":");
	if (groups.length !== 2) return null;

	const high = Number.parseInt(groups[0] ?? "", 16);
	const low = Number.parseInt(groups[1] ?? "", 16);

	if (!Number.isInteger(high) || !Number.isInteger(low)) return null;

	return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

/**
 * True when an address is not a public unicast destination.
 *
 * A zone id (`fe80::1%eth0`) is stripped first: it is not part of the address
 * and `net.BlockList` would not match the raw string.
 */
export function isBlockedAddress(address: string): boolean {
	const clean = address.split("%")[0] ?? address;
	const family = net.isIP(clean);

	if (family === 0) return true;

	const mapped = family === 6 ? mappedIpv4(clean) : null;

	if (mapped) return privateRanges.check(mapped, "ipv4");

	return privateRanges.check(clean, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Parse a URL and apply every rule that needs no DNS.
 *
 * Returns null for anything that cannot be a public page. The caller treats
 * null as "blocked", so an unexpected shape fails closed.
 */
export function parsePreviewUrl(raw: string): URL | null {
	const value = raw.trim();

	if (value.length === 0 || value.length > MAX_PREVIEW_URL_LENGTH) return null;

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}

	if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
	if (url.username.length > 0 || url.password.length > 0) return null;

	// `URL` normalises numeric and octal IPv4 forms, so `2130706433` already
	// reads as `127.0.0.1` here.
	const hostname = normalizeHostname(url.hostname);
	if (hostname.length === 0) return null;

	const literal = net.isIP(unbracket(hostname));
	if (literal === 0) {
		if (!hostname.includes(".")) return null;
		if (BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
			return null;
		}
	}

	// Ports are restricted to the two web defaults. An odd port is a weak
	// signal of an internal service, and no real page preview needs one.
	if (url.port.length > 0) {
		const port = Number(url.port);
		if (port !== 80 && port !== 443) return null;
		if (port !== DEFAULT_PORTS[url.protocol]) return null;
	}

	return url;
}

/** Build the stable cache key form of a parsed URL. */
export function canonicalizeUrl(url: URL): string {
	const hostname = normalizeHostname(url.hostname);
	const path = url.pathname.length > 0 ? url.pathname : "/";

	return `${url.protocol}//${hostname}${path}${url.search}`;
}

/** SHA-256 of the canonical URL, used as the identity column. */
export function hashUrl(canonical: string): string {
	return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Resolve a host name with a hard deadline.
 *
 * The losing `lookup` promise keeps running until the system resolver answers,
 * but it is ignored, so the caller never waits for it.
 */
async function resolveAddresses(hostname: string): Promise<ResolvedAddress[]> {
	let timer: ReturnType<typeof setTimeout> | undefined;

	try {
		const rows = await Promise.race([
			lookup(hostname, { all: true, verbatim: true }),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("DNS lookup timed out")),
					DNS_TIMEOUT_MS,
				);
			}),
		]);

		return rows.map((row) => ({
			address: row.address,
			family: row.family === 6 ? 6 : 4,
		}));
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Resolve a URL to public addresses.
 *
 * Every returned address is checked, not just the one that will be connected
 * to. A host that returns one public and one private address is rejected
 * outright, because picking the public one would still leave a rebinding
 * window on the next lookup.
 */
export async function resolvePreviewTarget(
	raw: string,
): Promise<PreviewTargetResult> {
	const url = parsePreviewUrl(raw);

	if (!url) return { ok: false, reason: "blocked" };

	const hostname = normalizeHostname(url.hostname);
	const literal = net.isIP(unbracket(hostname));
	const port =
		url.port.length > 0 ? Number(url.port) : DEFAULT_PORTS[url.protocol];

	let addresses: ResolvedAddress[];

	if (literal !== 0) {
		addresses = [
			{
				address: unbracket(hostname),
				family: literal === 4 ? 4 : 6,
			},
		];
	} else {
		try {
			addresses = await resolveAddresses(hostname);
		} catch {
			// A host that does not resolve, or takes too long, cannot be
			// previewed. This is not an error the user needs to see.
			return { ok: false, reason: "unsupported" };
		}
	}

	if (addresses.length === 0) return { ok: false, reason: "unsupported" };

	for (const entry of addresses) {
		if (isBlockedAddress(entry.address)) {
			return { ok: false, reason: "blocked" };
		}
	}

	return {
		ok: true,
		target: {
			url,
			canonical: canonicalizeUrl(url),
			hostname,
			port,
			addresses,
		},
	};
}

/** True when `raw` is a link the preview pipeline is willing to store. */
export function isPreviewableUrl(raw: string): boolean {
	return parsePreviewUrl(raw) !== null;
}
