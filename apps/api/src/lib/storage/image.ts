/**
 * Image content detection.
 *
 * Why: a file extension and a Content-Type header are both client supplied.
 * The worker checks the actual leading bytes so an executable renamed to
 * `avatar.png` cannot be stored and later served from our origin.
 *
 * Used by: the upload verification worker.
 */

export type DetectedImageType = "image/png" | "image/jpeg" | null;

/** PNG files always start with this 8 byte signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Every JPEG (JFIF, EXIF, raw) starts with the same 3 byte marker. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** Compare a byte array against a signature prefix. */
function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
	if (bytes.length < signature.length) return false;

	return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * Detect an allowed image type from its leading bytes.
 *
 * Returns null for anything that is not PNG or JPEG, including SVG and WebP,
 * because those are not in the avatar policy.
 */
export function sniffImageType(bytes: Uint8Array): DetectedImageType {
	if (startsWith(bytes, PNG_SIGNATURE)) return "image/png";
	if (startsWith(bytes, JPEG_SIGNATURE)) return "image/jpeg";
	return null;
}
