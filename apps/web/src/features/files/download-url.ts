/**
 * Download URL for an attachment.
 *
 * Why a query flag: the API serves discussion attachments with an attachment
 * disposition already, but milestone attachments are inline, and the `download`
 * attribute is ignored on a cross origin link. `?download=1` asks the API to
 * send the attachment disposition for every file type.
 *
 * Used by: features/files/file-viewer-dialog.tsx and the attachment chip.
 */

/** True when the URL points at the app's own file route. */
function isOwnFileUrl(src: string): boolean {
	return src.includes("/files/");
}

/** Add the download flag to an app file URL. External URLs are unchanged. */
export function fileDownloadUrl(src: string): string {
	if (!isOwnFileUrl(src)) return src;

	try {
		const url = new URL(src);
		url.searchParams.set("download", "1");
		return url.toString();
	} catch {
		return src;
	}
}
