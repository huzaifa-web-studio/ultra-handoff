/**
 * Which viewer can render an attachment.
 *
 * Why a small classification module: the attachment chip only stores the MIME
 * type and the file name, and the two can disagree (some platforms send an
 * empty type, others send the generic octet stream). Keeping the decision in
 * one place means the chip, the dialog and any future surface agree on what is
 * previewable.
 *
 * Used by: features/files/file-viewer-dialog.tsx.
 */

/** The preview strategies the app supports today. */
export type ViewerKind =
	| "pdf"
	| "text"
	| "csv"
	| "image"
	| "docx"
	| "sheet"
	| "unsupported";

const DOCX_MIME =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif"]);

/** Lowercase extension without the dot, or an empty string. */
function extensionOf(name: string): string {
	const index = name.lastIndexOf(".");

	return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

/**
 * Pick the viewer for a file.
 *
 * The MIME type wins when it is specific. The extension is the fallback for the
 * platforms that report an empty or generic type.
 */
export function viewerKindFor(file: {
	name: string;
	mime: string;
}): ViewerKind {
	const mime = file.mime.split(";")[0]?.trim().toLowerCase() ?? "";
	const extension = extensionOf(file.name);

	if (mime === "application/pdf" || extension === "pdf") return "pdf";
	if (mime === "text/csv" || extension === "csv") return "csv";
	if (mime === "text/plain" || extension === "txt") return "text";
	if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
		return "image";
	}
	if (mime === DOCX_MIME || extension === "docx") return "docx";
	if (mime === XLSX_MIME || extension === "xlsx") return "sheet";

	return "unsupported";
}
