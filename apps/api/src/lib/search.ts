/**
 * Text search helpers.
 *
 * Why this file: comment search and conversation search are the same feature
 * over two tables. One snippet builder keeps the highlight context, the length
 * and the ellipsis identical on both surfaces, so a hit reads the same wherever
 * it was found.
 *
 * Used by: `services/conversation/search.ts` and the comment search route.
 */

/**
 * Shorten a plain text mirror around the first occurrence of a term.
 *
 * Why around the match and not from the start: a search hit in the middle of a
 * long message is unrecognisable if the snippet always shows the first line.
 * Whitespace is squashed first, because the mirror contains newlines and a
 * result row has one line.
 */
export function snippetAround(text: string, term: string, max = 140): string {
	const squashed = text.replace(/\s+/g, " ").trim();

	if (squashed.length <= max) return squashed;

	const index = squashed.toLowerCase().indexOf(term.toLowerCase());

	if (index < 0) return `${squashed.slice(0, max - 3).trimEnd()}...`;

	const start = Math.max(
		0,
		index - Math.floor(Math.max(0, max - term.length) / 2),
	);
	const end = Math.min(squashed.length, start + max);
	const prefix = start > 0 ? "..." : "";
	const suffix = end < squashed.length ? "..." : "";

	return `${prefix}${squashed.slice(start, end).trim()}${suffix}`;
}

/**
 * Normalise a search term.
 *
 * A one character query matches almost every row and cannot use the trigram
 * index well, so the service answers an empty result instead of scanning.
 */
export function normaliseSearchTerm(value: string): string | null {
	const term = value.trim();

	return term.length >= 2 ? term : null;
}
