/**
 * Magic byte and dimension checks for preview images.
 *
 * Why not trust the target's Content-Type: an attacker controls the image URL
 * and can label anything `image/png`. Every byte we serve is sniffed here, and
 * only raster formats with a readable header are accepted.
 *
 * SVG is deliberately absent. An SVG can carry script and would be served from
 * our own origin, which turns a link preview into stored XSS. ICO is accepted
 * for favicons only.
 *
 * Why dimensions are read: a tiny compressed image can declare enormous
 * dimensions and make a browser decoder allocate a huge buffer. A cap on the
 * header values removes the cheapest version of that attack.
 *
 * Used by: src/queues/link-preview.ts.
 */

/** Formats a preview asset may be stored as. */
export type SniffedImage = {
	mime:
		| "image/png"
		| "image/jpeg"
		| "image/gif"
		| "image/webp"
		| "image/x-icon";
	extension: "png" | "jpg" | "gif" | "webp" | "ico";
	width: number;
	height: number;
};

/** Largest width or height accepted. */
export const MAX_IMAGE_DIMENSION = 4096;

/** Smallest accepted dimension. A zero would break the layout maths. */
const MIN_IMAGE_DIMENSION = 1;

/** True when a dimension pair is usable. */
function validDimensions(width: number, height: number): boolean {
	return (
		Number.isInteger(width) &&
		Number.isInteger(height) &&
		width >= MIN_IMAGE_DIMENSION &&
		height >= MIN_IMAGE_DIMENSION &&
		width <= MAX_IMAGE_DIMENSION &&
		height <= MAX_IMAGE_DIMENSION
	);
}

/** PNG signature plus the IHDR header. */
function sniffPng(buffer: Buffer): SniffedImage | null {
	const signature = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);

	if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature))
		return null;
	if (buffer.toString("latin1", 12, 16) !== "IHDR") return null;

	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);

	if (!validDimensions(width, height)) return null;

	return { mime: "image/png", extension: "png", width, height };
}

/** JPEG frame header scan for the real dimensions. */
function sniffJpeg(buffer: Buffer): SniffedImage | null {
	if (buffer.length < 4) return null;
	if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

	let offset = 2;

	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 0xff) {
			offset += 1;
			continue;
		}

		const marker = buffer[offset + 1] ?? 0;

		// Standalone markers carry no length.
		if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
			offset += 2;
			continue;
		}
		// Restart markers.
		if (marker >= 0xd0 && marker <= 0xd7) {
			offset += 2;
			continue;
		}

		const length = buffer.readUInt16BE(offset + 2);
		if (length < 2) return null;

		const isFrameHeader =
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc;

		if (isFrameHeader) {
			const height = buffer.readUInt16BE(offset + 5);
			const width = buffer.readUInt16BE(offset + 7);

			if (!validDimensions(width, height)) return null;

			return { mime: "image/jpeg", extension: "jpg", width, height };
		}

		offset += 2 + length;
	}

	return null;
}

/** GIF logical screen descriptor. */
function sniffGif(buffer: Buffer): SniffedImage | null {
	if (buffer.length < 10) return null;

	const header = buffer.toString("latin1", 0, 6);
	if (header !== "GIF87a" && header !== "GIF89a") return null;

	const width = buffer.readUInt16LE(6);
	const height = buffer.readUInt16LE(8);

	if (!validDimensions(width, height)) return null;

	return { mime: "image/gif", extension: "gif", width, height };
}

/** WebP has three container variants with different headers. */
function sniffWebp(buffer: Buffer): SniffedImage | null {
	if (buffer.length < 30) return null;
	if (buffer.toString("latin1", 0, 4) !== "RIFF") return null;
	if (buffer.toString("latin1", 8, 12) !== "WEBP") return null;

	const chunk = buffer.toString("latin1", 12, 16);

	if (chunk === "VP8 ") {
		// Lossy: 3 byte frame tag, 3 byte start code, then 14 bit dimensions.
		const width = buffer.readUInt16LE(26) & 0x3fff;
		const height = buffer.readUInt16LE(28) & 0x3fff;

		if (!validDimensions(width, height)) return null;

		return { mime: "image/webp", extension: "webp", width, height };
	}

	if (chunk === "VP8L") {
		// Lossless: a signature byte, then 14 bit dimensions packed across
		// four bytes, each stored minus one.
		if (buffer[20] !== 0x2f) return null;

		const bits = buffer.readUInt32LE(21);
		const width = (bits & 0x3fff) + 1;
		const height = ((bits >> 14) & 0x3fff) + 1;

		if (!validDimensions(width, height)) return null;

		return { mime: "image/webp", extension: "webp", width, height };
	}

	if (chunk === "VP8X") {
		// Extended: 24 bit dimensions stored minus one.
		const width = buffer.readUIntLE(24, 3) + 1;
		const height = buffer.readUIntLE(27, 3) + 1;

		if (!validDimensions(width, height)) return null;

		return { mime: "image/webp", extension: "webp", width, height };
	}

	return null;
}

/** ICO directory entry. A zero dimension means 256. */
function sniffIco(buffer: Buffer): SniffedImage | null {
	if (buffer.length < 22) return null;
	if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;

	const count = buffer.readUInt16LE(4);
	if (count < 1) return null;

	const width = buffer[6] === 0 ? 256 : (buffer[6] ?? 0);
	const height = buffer[7] === 0 ? 256 : (buffer[7] ?? 0);

	if (!validDimensions(width, height)) return null;

	return { mime: "image/x-icon", extension: "ico", width, height };
}

/**
 * Identify an image from its bytes.
 *
 * Returns null for anything that is not a supported raster format, including
 * SVG, HTML and PDF disguised with an image content type.
 */
export function sniffImage(buffer: Buffer): SniffedImage | null {
	return (
		sniffPng(buffer) ??
		sniffJpeg(buffer) ??
		sniffGif(buffer) ??
		sniffWebp(buffer) ??
		sniffIco(buffer)
	);
}
