/**
 * Link preview storage and reads.
 *
 * The split is deliberate:
 *
 *   - reads are cheap database lookups and never touch the network
 *   - writes happen in the background worker, after a milestone save
 *
 * That is what keeps a hover card instant and stops the API from becoming an
 * on-demand URL fetcher.
 *
 * Every row is organization scoped and runs through `withTenant`, so a preview
 * cannot leak across workspaces even when two tenants link the same page.
 *
 * Used by: src/routes/link-previews.ts, src/queues/link-preview.ts and
 * src/services/milestone.service.ts.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import { linkPreview } from "../db/schema";
import { type TenantScope, type TenantTx, withTenant } from "../db/tenant";
import {
	collectPreviewUrls,
	type PreviewAsset,
	type ResolveOutcome,
} from "../lib/link-preview/resolve";
import {
	canonicalizeUrl,
	hashUrl,
	normalizeHostname,
	parsePreviewUrl,
} from "../lib/link-preview/url";
import { objectUrl, putObject } from "../lib/storage";

/** How long a resolved preview is trusted before it is fetched again. */
export const PREVIEW_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Most URLs one read request may ask about. */
export const MAX_READ_URLS = 50;

/** One preview as the browser sees it. */
export type LinkPreviewWire = {
	url: string;
	status: "pending" | "ready" | "unavailable" | "blocked";
	title: string | null;
	description: string | null;
	siteName: string | null;
	imageUrl: string | null;
	imageWidth: number | null;
	imageHeight: number | null;
	faviconUrl: string | null;
	/** Display host, without `www.` and without brackets for IPv6. */
	domain: string;
	fetchedAt: string | null;
};

/** A database row, before it is mapped to the wire shape. */
type PreviewRecord = typeof linkPreview.$inferSelect;

/** Read the display host from a canonical URL, tolerating junk. */
function displayHost(canonical: string): string {
	try {
		return normalizeHostname(new URL(canonical).hostname)
			.replace(/^www\./, "")
			.replace(/^\[/, "")
			.replace(/\]$/, "");
	} catch {
		return canonical;
	}
}

/** Map a row into the wire shape. */
function toWire(record: PreviewRecord): LinkPreviewWire {
	return {
		url: record.url,
		status: record.status as LinkPreviewWire["status"],
		title: record.title,
		description: record.description,
		siteName: record.siteName,
		imageUrl: record.imageKey ? objectUrl(record.imageKey) : null,
		imageWidth: record.imageWidth,
		imageHeight: record.imageHeight,
		faviconUrl: record.faviconKey ? objectUrl(record.faviconKey) : null,
		domain: displayHost(record.url),
		fetchedAt: record.fetchedAt ? record.fetchedAt.toISOString() : null,
	};
}

/** Canonicalise and hash a set of URL strings for lookup. */
function toLookup(urls: string[]): Map<string, string> {
	const byHash = new Map<string, string>();

	for (const raw of urls) {
		const parsed = parsePreviewUrl(raw);

		if (!parsed) continue;

		const canonical = canonicalizeUrl(parsed);
		byHash.set(hashUrl(canonical), canonical);
	}

	return byHash;
}

/** Previews keyed by the exact URL string the caller sent. */
export type LinkPreviewMap = Record<string, LinkPreviewWire>;

/**
 * Read the previews that already exist for a set of URLs.
 *
 * The result is keyed by the input string, not the canonical form, so the
 * client can look a card up with the href it already has. Two inputs that
 * canonicalise to the same page both receive the same entry.
 *
 * Unknown URLs are simply absent from the result. The client renders a compact
 * card for those and asks again later; it never triggers a fetch.
 */
export async function readLinkPreviews(
	tenant: TenantScope,
	urls: string[],
): Promise<LinkPreviewMap> {
	const inputToHash = new Map<string, string>();

	for (const raw of urls.slice(0, MAX_READ_URLS)) {
		const parsed = parsePreviewUrl(raw);
		if (!parsed) continue;

		inputToHash.set(raw, hashUrl(canonicalizeUrl(parsed)));
	}

	if (inputToHash.size === 0) return {};

	const rows = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		(tx) =>
			tx
				.select()
				.from(linkPreview)
				.where(
					and(
						eq(linkPreview.organizationId, tenant.organizationId),
						inArray(linkPreview.urlHash, [...new Set(inputToHash.values())]),
					),
				),
	);

	const byHash = new Map(rows.map((row) => [row.urlHash, toWire(row)]));
	const result: LinkPreviewMap = {};

	for (const [input, hash] of inputToHash) {
		const preview = byHash.get(hash);
		if (preview) result[input] = preview;
	}

	return result;
}

/** Store one fetched asset and return its object key. */
async function storeAsset(
	tenant: TenantScope,
	urlHash: string,
	kind: "og" | "icon",
	asset: PreviewAsset,
): Promise<string> {
	const key = `organizations/${tenant.organizationId}/link-previews/${urlHash}-${kind}.${asset.image.extension}`;

	await putObject(key, asset.buffer, asset.image.mime);

	return key;
}

/**
 * Write the result of one resolution.
 *
 * Images are uploaded before the row is written. An orphan object is harmless
 * and rare; a row that points at a missing object would render a broken image.
 */
export async function storeResolvedPreview(
	tenant: TenantScope,
	outcome: ResolveOutcome,
): Promise<void> {
	if (!outcome.ok) {
		await withTenant(
			{ organizationId: tenant.organizationId, userId: tenant.userId },
			async (tx) => {
				await tx
					.insert(linkPreview)
					.values({
						id: randomUUID(),
						organizationId: tenant.organizationId,
						url: outcome.canonical,
						urlHash: outcome.urlHash,
						status: outcome.code === "blocked" ? "blocked" : "unavailable",
						errorCode: outcome.code,
						fetchedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: [linkPreview.organizationId, linkPreview.urlHash],
						set: {
							status: outcome.code === "blocked" ? "blocked" : "unavailable",
							errorCode: outcome.code,
							fetchedAt: new Date(),
						},
					});
			},
		);
		return;
	}

	const [imageKey, faviconKey] = await Promise.all([
		outcome.data.image
			? storeAsset(tenant, outcome.urlHash, "og", outcome.data.image)
			: Promise.resolve(null),
		outcome.data.favicon
			? storeAsset(tenant, outcome.urlHash, "icon", outcome.data.favicon)
			: Promise.resolve(null),
	]);

	await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		async (tx) => {
			await tx
				.insert(linkPreview)
				.values({
					id: randomUUID(),
					organizationId: tenant.organizationId,
					url: outcome.canonical,
					urlHash: outcome.urlHash,
					status: "ready",
					title: outcome.data.title || null,
					description: outcome.data.description || null,
					siteName: outcome.data.siteName || null,
					imageKey,
					imageWidth: outcome.data.image?.image.width ?? null,
					imageHeight: outcome.data.image?.image.height ?? null,
					faviconKey,
					errorCode: null,
					fetchedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [linkPreview.organizationId, linkPreview.urlHash],
					set: {
						status: "ready",
						title: outcome.data.title || null,
						description: outcome.data.description || null,
						siteName: outcome.data.siteName || null,
						imageKey,
						imageWidth: outcome.data.image?.image.width ?? null,
						imageHeight: outcome.data.image?.image.height ?? null,
						faviconKey,
						errorCode: null,
						fetchedAt: new Date(),
					},
				});
		},
	);
}

/**
 * Read which of these URLs still need a fetch.
 *
 * A row needs work when it is missing, still pending, or older than the TTL.
 * Blocked rows are never retried: the answer will not change.
 */
export async function findUrlsNeedingFetch(
	tx: TenantTx,
	tenant: TenantScope,
	urls: string[],
): Promise<string[]> {
	if (urls.length === 0) return [];

	const byHash = toLookup(urls);
	if (byHash.size === 0) return [];

	const staleBefore = new Date(Date.now() - PREVIEW_TTL_MS);

	const rows = await tx
		.select({
			urlHash: linkPreview.urlHash,
			status: linkPreview.status,
			fetchedAt: linkPreview.fetchedAt,
		})
		.from(linkPreview)
		.where(
			and(
				eq(linkPreview.organizationId, tenant.organizationId),
				inArray(linkPreview.urlHash, [...byHash.keys()]),
			),
		);

	const known = new Map(rows.map((row) => [row.urlHash, row]));

	return [...byHash.entries()]
		.filter(([hash]) => {
			const row = known.get(hash);

			if (!row) return true;
			if (row.status === "pending") return true;
			if (row.status === "blocked") return false;
			if (!row.fetchedAt) return true;

			return row.fetchedAt < staleBefore;
		})
		.map(([, canonical]) => canonical);
}

/**
 * Enqueue previews for every link in a saved document.
 *
 * Called after the save transaction commits, so a failed preview can never
 * fail the milestone write. The enqueue itself is deduplicated by job id, and
 * `findUrlsNeedingFetch` keeps a repeated save from re-fetching fresh rows.
 */
export async function queueDocumentPreviews(
	tenant: TenantScope,
	description: unknown,
): Promise<void> {
	const urls = collectPreviewUrls(description);

	if (urls.length === 0) return;

	const { enqueueLinkPreview } = await import("../queues/link-preview");

	const pending = await withTenant(
		{ organizationId: tenant.organizationId, userId: tenant.userId },
		(tx) => findUrlsNeedingFetch(tx, tenant, urls),
	);

	for (const url of pending) {
		await enqueueLinkPreview({
			organizationId: tenant.organizationId,
			userId: tenant.userId,
			url,
		});
	}
}
