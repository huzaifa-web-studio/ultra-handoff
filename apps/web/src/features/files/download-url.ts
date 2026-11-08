/**
 * Download URL for an attachment.
 *
 * Why a query flag: the API serves discussion attachments with an attachment
 * disposition already, but milestone attachments are inline, and the `download`
 * attribute is ignored on a cross origin link. `?download=1` asks the API to
 * send the attachment disposition for every file type.
 *
 * Why the name: the object key is a UUID, so without the original name a saved
 * file would be called `6f1c....pdf`. The API sanitises the value before it
 * becomes a `Content-Disposition` header.
 *
 * Used by: features/files/file-viewer-dialog.tsx and the attachment chip.
 */

/** True when the URL points at the app's own file route. */
function isOwnFileUrl(src: string): boolean {
	return src.includes("/files/");
}

/** Add the download flag and the original name to an app file URL. */
export function fileDownloadUrl(src: string, name?: string): string {
	if (!isOwnFileUrl(src)) return src;

	try {
		const url = new URL(src);
		url.searchParams.set("download", "1");

		if (name && name.trim().length > 0) {
			url.searchParams.set("name", name);
		}

		return url.toString();
	} catch {
		return src;
	}
}
