/**
 * Figma community metadata.
 *
 * Why this file: Figma serves a small public JSON payload instead of useful
 * Open Graph tags, so it needs its own parser.
 *
 * Used by: `resolve.ts`.
 */

import { fieldsFrom, record, text } from "./shared";
import type { ProviderMetadata } from "./types";
export function parseFigmaCommunityMetadata(
	html: string,
): ProviderMetadata | null {
	const scripts = html.matchAll(
		/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
	);

	for (const [, content] of scripts) {
		if (!content) continue;
		try {
			const parsed = record(JSON.parse(content) as unknown);
			const graph = parsed?.["@graph"];
			const nodes = Array.isArray(graph) ? graph : [parsed];
			const work = nodes.map(record).find((node) => {
				const type = node?.["@type"];
				return (
					type === "CreativeWork" ||
					(Array.isArray(type) && type.includes("CreativeWork"))
				);
			});
			if (!work) continue;

			const creator = record(work.creator);
			const stats = Array.isArray(work.interactionStatistic)
				? work.interactionStatistic
				: [];
			const likes = stats.find((entry) => {
				const interaction = record(entry)?.interactionType;
				return text(record(interaction)?.["@type"] ?? interaction, 80).endsWith(
					"LikeAction",
				);
			});
			const uses = stats.find((entry) => {
				const interaction = record(entry)?.interactionType;
				return text(record(interaction)?.["@type"] ?? interaction, 80).endsWith(
					"UseAction",
				);
			});
			const fields = fieldsFrom([
				["Creator", creator?.name],
				["Uses", record(uses)?.userInteractionCount],
				["Likes", record(likes)?.userInteractionCount],
			]);
			if (fields.length > 0) {
				return { provider: "Figma", kind: "Community file", fields };
			}
		} catch {
			// A malformed JSON-LD block should not prevent other blocks being read.
		}
	}

	return null;
}
