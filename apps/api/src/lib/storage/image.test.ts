/**
 * Upload image byte sniffing.
 *
 * Why these exist: an uploaded avatar is declared as PNG or JPEG by the client.
 * This function is the server's only proof that the bytes match. A miss here
 * would let a non image reach `/files` from the app origin.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { sniffImageType } from "./image";

/** Minimal byte sequences with the signatures the detector reads. */
const png = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
const webp = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const svg = new TextEncoder().encode(
	'<svg xmlns="http://www.w3.org/2000/svg">',
);
const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");

describe("sniffImageType", () => {
	test("recognises a PNG signature", () => {
		expect(sniffImageType(png)).toBe("image/png");
	});

	test("recognises a JPEG signature", () => {
		expect(sniffImageType(jpeg)).toBe("image/jpeg");
	});

	test("rejects formats outside the avatar policy", () => {
		expect(sniffImageType(gif)).toBeNull();
		expect(sniffImageType(webp)).toBeNull();
		expect(sniffImageType(svg)).toBeNull();
		expect(sniffImageType(html)).toBeNull();
	});

	test("rejects an empty or truncated buffer", () => {
		expect(sniffImageType(new Uint8Array())).toBeNull();
		expect(sniffImageType(png.subarray(0, 4))).toBeNull();
		expect(sniffImageType(jpeg.subarray(0, 2))).toBeNull();
	});
});
