/**
 * Provider JSON and field helpers.
 *
 * Why this file: every adapter reduces a provider response to plain text fields
 * with the same length cap and the same narrow JSON reader. Keeping them here
 * means one adapter cannot render a different shape.
 *
 * Used by: `figma.ts` and `adapters.ts`.
 */

import { fetchResource } from "../http";
import { cleanText } from "../parse";
import type { ProviderField } from "./types";

export function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

export function text(value: unknown, limit = 180): string {
	return typeof value === "string" ? cleanText(value, limit) : "";
}

export function number(value: unknown): string {
	return typeof value === "number" && Number.isFinite(value)
		? new Intl.NumberFormat("en").format(value)
		: "";
}

export function fieldsFrom(entries: [string, unknown][]): ProviderField[] {
	return entries
		.flatMap(([label, value]) => {
			const formatted = text(value) || number(value);
			return formatted ? [{ label, value: formatted }] : [];
		})
		.slice(0, 6);
}

/** Read JSON only through the hardened URL resolver and bounded transport. */
export async function getJson(url: string): Promise<unknown | null> {
	try {
		const result = await fetchResource(url, {
			maxBytes: 128 * 1024,
			acceptContentTypes: ["application/json", "text/json"],
			accept: "application/json",
			timeoutMs: 5_000,
		});
		if (!result.ok) return null;
		return JSON.parse(result.response.body.toString("utf8")) as unknown;
	} catch {
		// Provider outages, malformed JSON and throttling are non-fatal. The
		// resolver still returns the universal page metadata preview.
		return null;
	}
}
