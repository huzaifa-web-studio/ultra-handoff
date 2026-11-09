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
 * A specific MIME type wins because it describes the bytes, so a mislabelled
 * file name cannot send a PDF into the text viewer. The extension is only a
 * fallback: when the MIME is empty, generic (`application/octet-stream`) or
 * names a type no viewer supports, the name is the only signal left. That also
 * keeps a CSV uploaded with the Windows `application/vnd.ms-excel` type
 * working, which a strict MIME-only rule would drop.
 */
export function viewerKindFor(file: {
	name: string;
	mime: string;
}): ViewerKind {
	const mime = file.mime.split(";")[0]?.trim().toLowerCase() ?? "";
	const extension = extensionOf(file.name);

	// The declared type wins when a viewer handles it.
	if (mime === "application/pdf") return "pdf";
	if (mime === "text/csv") return "csv";
	if (mime === "text/plain") return "text";
	if (mime.startsWith("image/")) return "image";
	if (mime === DOCX_MIME) return "docx";
	if (mime === XLSX_MIME) return "sheet";

	// Nothing specific was declared, so fall back to the file name.
	if (extension === "pdf") return "pdf";
	if (extension === "csv") return "csv";
	if (extension === "txt") return "text";
	if (IMAGE_EXTENSIONS.has(extension)) return "image";
	if (extension === "docx") return "docx";
	if (extension === "xlsx") return "sheet";

	return "unsupported";
}
