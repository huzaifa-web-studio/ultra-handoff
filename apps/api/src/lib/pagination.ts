/**
 * Query limit helpers.
 *
 * Why shared: every list route clamps the browser supplied limit. Duplicating
 * the clamp meant a route could quietly accept a different maximum.
 *
 * Used by: `routes/conversations.ts` and `routes/channels/`.
 */

/** Clamp a page size instead of trusting the browser. */
export function clampLimit(
	value: string | undefined,
	fallback: number,
	max: number,
): number {
	const parsed = Number.parseInt(value ?? "", 10);

	return Number.isFinite(parsed)
		? Math.min(max, Math.max(1, parsed))
		: fallback;
}
