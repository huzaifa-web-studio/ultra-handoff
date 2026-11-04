/**
 * Tests for the image sniffing rules.
 *
 * The security property is "only raster formats with sane dimensions are
 * accepted", so the negative cases matter more than the positive ones.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { MAX_IMAGE_DIMENSION, sniffImage } from "./images";

/** A valid 1x1 PNG, base64 encoded. */
const PNG_1X1 = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

/** Build a minimal JPEG header with a SOF0 frame. */
function jpegHeader(width: number, height: number): Buffer {
	const buffer = Buffer.alloc(64);
	let offset = 0;

	// SOI
	buffer[offset++] = 0xff;
	buffer[offset++] = 0xd8;
	// APP0 with a 16 byte length
	buffer[offset++] = 0xff;
	buffer[offset++] = 0xe0;
	buffer.writeUInt16BE(16, offset);
	offset += 16;
	// SOF0
	buffer[offset++] = 0xff;
	buffer[offset++] = 0xc0;
	buffer.writeUInt16BE(17, offset);
	offset += 2;
	buffer[offset++] = 8;
	buffer.writeUInt16BE(height, offset);
	offset += 2;
	buffer.writeUInt16BE(width, offset);

	return buffer;
}

/** Build a GIF header with the given logical screen size. */
function gifHeader(width: number, height: number): Buffer {
	const buffer = Buffer.alloc(16);
	buffer.write("GIF89a", 0, "latin1");
	buffer.writeUInt16LE(width, 6);
	buffer.writeUInt16LE(height, 8);

	return buffer;
}

/** Build an ICO header with one 16x16 entry. */
function icoHeader(widthByte: number, heightByte: number): Buffer {
	const buffer = Buffer.alloc(22);
	buffer.writeUInt16LE(0, 0);
	buffer.writeUInt16LE(1, 2);
	buffer.writeUInt16LE(1, 4);
	buffer[6] = widthByte;
	buffer[7] = heightByte;

	return buffer;
}

describe("sniffImage", () => {
	test("accepts a PNG and reads its dimensions", () => {
		expect(sniffImage(PNG_1X1)).toMatchObject({
			mime: "image/png",
			extension: "png",
			width: 1,
			height: 1,
		});
	});

	test("accepts a JPEG and reads its frame header", () => {
		expect(sniffImage(jpegHeader(1200, 630))).toMatchObject({
			mime: "image/jpeg",
			width: 1200,
			height: 630,
		});
	});

	test("accepts a GIF", () => {
		expect(sniffImage(gifHeader(48, 48))).toMatchObject({
			mime: "image/gif",
			width: 48,
			height: 48,
		});
	});

	test("accepts an ICO and treats zero as 256", () => {
		expect(sniffImage(icoHeader(0, 0))).toMatchObject({
			mime: "image/x-icon",
			width: 256,
			height: 256,
		});
	});

	test.each([
		["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
		["HTML", Buffer.from("<!doctype html><html></html>")],
		["PDF", Buffer.from("%PDF-1.7")],
		["an empty buffer", Buffer.alloc(0)],
		["a truncated PNG", PNG_1X1.subarray(0, 12)],
	])("rejects %s", (_label, buffer) => {
		expect(sniffImage(buffer)).toBeNull();
	});

	test("rejects a PNG with absurd dimensions", () => {
		const forged = Buffer.from(PNG_1X1);
		forged.writeUInt32BE(MAX_IMAGE_DIMENSION + 1, 16);

		expect(sniffImage(forged)).toBeNull();
	});

	test("rejects a JPEG with a zero width", () => {
		expect(sniffImage(jpegHeader(0, 100))).toBeNull();
	});
});
