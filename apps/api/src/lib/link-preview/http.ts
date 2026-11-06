/**
 * Hardened outbound HTTP for link previews.
 *
 * Why not `fetch`: Bun ignores the `lookup` option on `node:https`, so a
 * validated host name would be resolved a second time at connect time and a
 * DNS rebinding attack could reach a private address. This module opens the
 * TCP or TLS socket itself, to the exact address that was validated, and hands
 * it to `http.request` through `createConnection`. Certificate validation is
 * untouched: the TLS socket is created with the host name as SNI, so the
 * certificate is still checked against the host name.
 *
 * Additional guarantees:
 *
 *   - redirects are followed manually, and every hop is fully re-validated
 *   - the total time budget covers all hops, not each one
 *   - the response body is capped, after decompression
 *   - only html is accepted, and only the first part of it is read
 *   - no cookies, no authorization, no client identifiers are sent
 *
 * Error codes are stable strings. The target's status line and error text are
 * never surfaced, so a preview cannot be used as a blind port scanner.
 *
 * Used by: src/queues/link-preview.ts.
 */

import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Readable, Transform } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";

import {
	type PreviewTarget,
	type ResolvedAddress,
	resolvePreviewTarget,
} from "./url";

/** Stable failure reasons. Never shown to a user verbatim. */
export type FetchErrorCode =
	| "blocked"
	| "unsupported"
	| "network"
	| "timeout"
	| "too_large"
	| "not_html"
	| "http_error";

/** Cap on the HTML we read. A page head is far below this. */
export const MAX_DOCUMENT_BYTES = 512 * 1024;

/** Cap on an image or icon. */
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/** Total budget for one preview, including every redirect hop. */
export const FETCH_TIMEOUT_MS = 8_000;

/** Most redirects followed before giving up. */
const MAX_REDIRECTS = 3;

/** How this module identifies itself. Site owners can block us by name. */
const USER_AGENT =
	"HandoffLinkPreview/1.0 (+https://github.com/huzaifi/handoff; link preview bot)";

/** One successful response. */
export type FetchSuccess = {
	finalUrl: string;
	status: number;
	contentType: string;
	body: Buffer;
};

export type FetchResult =
	| { ok: true; response: FetchSuccess }
	| { ok: false; reason: FetchErrorCode };

type RequestOutcome =
	| FetchSuccess
	| { redirect: string }
	| { failure: FetchErrorCode };

/** Per call options. */
export type FetchOptions = {
	/** Largest accepted body, measured after decompression. */
	maxBytes: number;
	/** Total budget across redirects. */
	timeoutMs?: number;
	/** Accepted content type prefixes. */
	acceptContentTypes: readonly string[];
	/** Value for the Accept header. */
	accept?: string;
	/** Optional host-specific agent for public sites that reject scraper UAs. */
	userAgent?: string;
	/**
	 * Stop reading as soon as this marker appears in the decoded body.
	 *
	 * Used for `</head>`: a real page is often larger than the cap, but all
	 * the metadata we want is at the top. Without this, a large home page would
	 * be discarded as too large even though its head was read completely.
	 */
	stopAt?: string;
};

/** A decoded stream plus the byte counter that follows it. */
function decoderFor(encoding: string): Transform | null {
	switch (encoding) {
		case "":
		case "identity":
			return null;
		case "gzip":
		case "x-gzip":
			return zlib.createGunzip();
		case "deflate":
			return zlib.createInflate();
		case "br":
			return zlib.createBrotliDecompress();
		default:
			return null;
	}
}

/**
 * Read a stream up to a byte cap.
 *
 * The cap is applied to the decompressed bytes, which is what defeats a
 * compression bomb: the gzip stream is small, the inflated output is not, and
 * the counter stops at the cap either way.
 */
function readLimited(
	stream: Readable,
	maxBytes: number,
	stopAt?: string,
): Promise<Buffer | "too_large" | "network"> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		let total = 0;
		let tail = "";
		let settled = false;

		const finish = (value: Buffer | "too_large" | "network") => {
			if (settled) return;
			settled = true;
			stream.destroy();
			resolve(value);
		};

		stream.on("data", (chunk: Buffer) => {
			total += chunk.length;
			chunks.push(chunk);

			if (stopAt && total <= maxBytes) {
				// A tag can straddle two chunks, so the search window keeps the
				// tail of the previous chunk.
				const text = tail + chunk.toString("latin1").toLowerCase();

				if (text.includes(stopAt)) {
					finish(Buffer.concat(chunks));
					return;
				}

				tail = text.slice(-stopAt.length);
				return;
			}

			if (total > maxBytes) {
				// For a document the head is what matters, so an oversized page
				// is truncated instead of rejected. An asset has no such part,
				// so it is rejected outright.
				finish(
					stopAt ? Buffer.concat(chunks).subarray(0, maxBytes) : "too_large",
				);
			}
		});
		stream.on("end", () => finish(Buffer.concat(chunks)));
		stream.on("error", () => finish("network"));
		stream.on("close", () => finish(Buffer.concat(chunks)));
	});
}

/** Build the socket for one already validated address. */
function connectSocket(
	target: PreviewTarget,
	entry: ResolvedAddress,
): net.Socket {
	if (target.url.protocol === "http:") {
		return net.connect({
			host: entry.address,
			port: target.port,
			family: entry.family,
		});
	}

	return tls.connect({
		host: entry.address,
		port: target.port,
		family: entry.family,
		// The host name drives certificate verification and SNI. When the URL
		// is an IP literal there is no name, and `undefined` makes the check
		// run against the IP instead.
		servername: net.isIP(target.hostname) === 0 ? target.hostname : undefined,
		// Pin HTTP/1.1. Node's https client cannot speak HTTP/2, so letting the
		// server negotiate it would produce a broken response.
		ALPNProtocols: ["http/1.1"],
		rejectUnauthorized: true,
	});
}

/** One request and response, no redirect handling. */
function requestOnce(
	target: PreviewTarget,
	entry: ResolvedAddress,
	options: FetchOptions,
	deadline: number,
): Promise<RequestOutcome> {
	return new Promise((resolve) => {
		const isHttps = target.url.protocol === "https:";
		const transport = isHttps ? https : http;
		const socket = connectSocket(target, entry);

		let settled = false;
		const finish = (outcome: RequestOutcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			resolve(outcome);
		};

		const remaining = Math.max(1, deadline - Date.now());
		const timer = setTimeout(() => finish({ failure: "timeout" }), remaining);

		socket.once("error", () => finish({ failure: "network" }));

		const request = transport.request(
			{
				// `host` sets the Host header to the real name, while the socket
				// connects to the validated IP.
				host: target.hostname,
				port: target.port,
				path: `${target.url.pathname}${target.url.search}`,
				method: "GET",
				createConnection: () => socket,
				headers: {
					Host: target.hostname,
					"User-Agent": options.userAgent ?? USER_AGENT,
					Accept: options.accept ?? "text/html,application/xhtml+xml",
					"Accept-Encoding": "gzip, deflate, br",
					Connection: "close",
				},
			},
			(response) => {
				const status = response.statusCode ?? 0;
				const location = response.headers.location;

				if (status >= 300 && status < 400) {
					finish(
						typeof location === "string"
							? { redirect: location }
							: { failure: "http_error" },
					);
					return;
				}

				if (status < 200 || status >= 300) {
					finish({ failure: "http_error" });
					return;
				}

				const contentType = String(response.headers["content-type"] ?? "")
					.split(";")[0]
					?.trim()
					.toLowerCase();

				if (
					!options.acceptContentTypes.some((prefix) =>
						contentType.startsWith(prefix),
					)
				) {
					finish({ failure: "not_html" });
					return;
				}

				const encoding = String(
					response.headers["content-encoding"] ?? "",
				).toLowerCase();
				const decoder = decoderFor(encoding);

				// An encoding we cannot decode is a protocol we do not support,
				// not a reason to fall back to raw bytes.
				if (decoder === null && encoding !== "" && encoding !== "identity") {
					finish({ failure: "unsupported" });
					return;
				}

				const stream = decoder
					? (response.pipe(decoder) as Readable)
					: response;

				void readLimited(stream, options.maxBytes, options.stopAt).then(
					(body) => {
						if (body === "too_large") {
							finish({ failure: "too_large" });
							return;
						}
						if (body === "network") {
							finish({ failure: "network" });
							return;
						}

						finish({
							finalUrl: target.url.toString(),
							status,
							contentType,
							body,
						});
					},
				);
			},
		);

		request.once("error", () => finish({ failure: "network" }));
		request.end();
	});
}

/** Try every validated address until one answers or the budget runs out. */
async function requestWithAddresses(
	target: PreviewTarget,
	options: FetchOptions,
	deadline: number,
): Promise<RequestOutcome> {
	let lastFailure: FetchErrorCode = "network";

	for (const entry of target.addresses) {
		if (Date.now() >= deadline) return { failure: "timeout" };

		const outcome = await requestOnce(target, entry, options, deadline);

		if ("redirect" in outcome || "finalUrl" in outcome) return outcome;

		lastFailure = outcome.failure;

		// A policy or content failure will repeat on every address, so stop.
		if (
			lastFailure === "not_html" ||
			lastFailure === "too_large" ||
			lastFailure === "unsupported"
		) {
			return { failure: lastFailure };
		}
	}

	return { failure: lastFailure };
}

/**
 * Fetch a page or asset, following redirects, with every hop validated.
 *
 * Returns the final URL so relative metadata can be resolved against the page
 * that actually answered, not the one that was requested.
 */
export async function fetchResource(
	rawUrl: string,
	options: FetchOptions,
): Promise<FetchResult> {
	const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;

	let current = rawUrl;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
		if (Date.now() >= deadline) return { ok: false, reason: "timeout" };

		const resolved = await resolvePreviewTarget(current);

		if (!resolved.ok) {
			// A blocked hop is reported as blocked even if it was a redirect
			// target, because that is the meaningful security outcome.
			return {
				ok: false,
				reason: resolved.reason === "blocked" ? "blocked" : "unsupported",
			};
		}

		const outcome = await requestWithAddresses(
			resolved.target,
			options,
			deadline,
		);

		if ("failure" in outcome) return { ok: false, reason: outcome.failure };

		if ("redirect" in outcome) {
			try {
				current = new URL(outcome.redirect, resolved.target.url).toString();
			} catch {
				return { ok: false, reason: "unsupported" };
			}
			continue;
		}

		return { ok: true, response: outcome };
	}

	return { ok: false, reason: "http_error" };
}

/** Fetch an HTML page with the document limits applied. */
export function fetchPage(
	rawUrl: string,
	options: Pick<FetchOptions, "userAgent" | "accept"> = {},
): Promise<FetchResult> {
	return fetchResource(rawUrl, {
		maxBytes: MAX_DOCUMENT_BYTES,
		acceptContentTypes: ["text/html", "application/xhtml+xml"],
		accept: "text/html,application/xhtml+xml;q=0.9",
		stopAt: "</head>",
		...options,
	});
}

/** Fetch an image or icon with the asset limits applied. */
export function fetchAsset(
	rawUrl: string,
	options: Pick<FetchOptions, "userAgent"> = {},
): Promise<FetchResult> {
	return fetchResource(rawUrl, {
		maxBytes: MAX_ASSET_BYTES,
		acceptContentTypes: ["image/"],
		accept:
			"image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/*;q=0.8",
		...options,
	});
}
