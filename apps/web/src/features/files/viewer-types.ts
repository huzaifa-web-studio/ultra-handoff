/**
 * Shared props for a lazy loaded file viewer.
 *
 * Why one shape: the dialog loads the viewer module by kind, so every module
 * must accept the same two values. The file name is used for accessible labels,
 * not for fetching.
 *
 * Used by: features/files/file-viewer-dialog.tsx and viewers/*.
 */

export type ViewerProps = {
	/** Absolute URL of the file. */
	src: string;
	/** Original file name, used for labels. */
	name: string;
};
