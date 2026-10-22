/**
 * Slug generation shared by the project and organization forms.
 *
 * Why one helper: both forms turn a display name into a URL safe slug, and both
 * have to stop at the same maximum the API enforces. One function keeps the
 * diacritic folding, the single hyphen rule and the trailing hyphen cleanup
 * from drifting apart.
 *
 * Used by: features/projects/project-dialog.tsx and
 * features/organization/create-form.tsx.
 */

/**
 * Fold a display name into a lowercase, hyphen separated slug.
 *
 * Diacritics are folded before the non alphanumeric pass so "Café" becomes
 * "cafe" instead of "caf". The result is truncated to `maxLength`, then a
 * trailing hyphen left by the cut is removed, so the value always passes the
 * API slug rule.
 */
export function slugify(value: string, maxLength: number): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLength)
		.replace(/-+$/g, "");
}
