/**
 * Human readable file size.
 *
 * Shared by the attachment chip and the viewer header so the two surfaces can
 * never show a different number for the same file.
 *
 * Used by: features/files/file-viewer-dialog.tsx and
 * features/milestones/editor/editor-file.tsx.
 */

/** Format bytes as B, KB or MB, or undefined when the value is unusable. */
export function formatFileSize(bytes?: number): string | undefined {
	if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
		return undefined;
	}

	if (bytes < 1024) return `${String(bytes)} B`;
	if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
