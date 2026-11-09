/**
 * Decompressed body cap for link previews.
 *
 * Why this file exists: the cap is the only thing standing between a
 * compression bomb and memory, and the comment on `readLimited` promises an
 * exact byte limit. These cases pin that promise: a body larger than the cap
 * must come back at exactly the cap, never one chunk over.
 *
 * Used by: the phase 2 test report (P1-M16). Not part of the runtime.
 */

import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";

import { readLimited } from "./http";

/** One stream that emits each string as its own chunk, like a socket would. */
function streamOf(chunks: string[]): Readable {
	return Readable.from(chunks.map((chunk) => Buffer.from(chunk, "latin1")));
}

describe("readLimited", () => {
	test("truncates an oversized document to exactly the cap", async () => {
		const result = await readLimited(
			streamOf(["a".repeat(20), "b".repeat(20)]),
			25,
			"</head>",
		);

		expect(Buffer.isBuffer(result)).toBe(true);
		if (Buffer.isBuffer(result)) expect(result.length).toBe(25);
	});

	test("truncates a document whose stop tag arrives past the cap", async () => {
		// The tag is in the second chunk, which pushes the total to 43 bytes.
		const result = await readLimited(
			streamOf(["<head>", `${"x".repeat(30)}</head>`]),
			20,
			"</head>",
		);

		expect(Buffer.isBuffer(result)).toBe(true);
		if (Buffer.isBuffer(result)) {
			expect(result.length).toBe(20);
			expect(result.toString("latin1")).toBe(`${"<head>"}${"x".repeat(14)}`);
		}
	});

	test("returns the whole body when it is under the cap", async () => {
		const result = await readLimited(
			streamOf(["<head>", "tiny</head>"]),
			100,
			"</head>",
		);

		expect(Buffer.isBuffer(result)).toBe(true);
		if (Buffer.isBuffer(result)) {
			expect(result.toString("latin1")).toBe("<head>tiny</head>");
		}
	});

	test("rejects an asset that is larger than the cap", async () => {
		const result = await readLimited(streamOf(["a".repeat(20)]), 10);

		expect(result).toBe("too_large");
	});

	test("returns an asset at exactly the cap unchanged", async () => {
		const body = "a".repeat(10);
		const result = await readLimited(streamOf([body]), 10);

		expect(Buffer.isBuffer(result)).toBe(true);
		if (Buffer.isBuffer(result)) expect(result.toString("latin1")).toBe(body);
	});
});
