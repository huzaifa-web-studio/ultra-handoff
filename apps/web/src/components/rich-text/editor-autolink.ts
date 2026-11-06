/**
 * Autolink helper shared by the milestone and comment editors.
 *
 * Why: Plate's default `isUrl` requires a scheme, so typing or pasting
 * `example.com` leaves it as plain text. Returning the href here keeps the
 * visible text as typed while the anchor points at the secure URL.
 *
 * Returning undefined means "use the text unchanged", which is what a value
 * that already carries a scheme should do.
 *
 * Used by: editor-kit.tsx and comments/editor/comment-kit.tsx.
 */
export function autolinkHref(text: string): string | undefined {
	const value = text.trim();

	if (value.length === 0) return undefined;
	// Already a full URL, mailto or tel. Let Plate validate it as is.
	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
	// A host with at least one dot, optionally with a path. No spaces allowed.
	if (!/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(value)) {
		return undefined;
	}

	return `https://${value}`;
}
