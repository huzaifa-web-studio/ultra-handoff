/**
 * Tests for metadata parsing and text cleaning.
 *
 * The cases here are the ones that produced visible garbage during manual
 * testing: HTML entities in attributes, bidi overrides and control characters.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { cleanText, decodeHtml, parsePageMetadata } from "./parse";

describe("cleanText", () => {
	test("decodes the entities that survive attribute parsing", () => {
		expect(cleanText("GitHub&#39;s platform &amp; community", 100)).toBe(
			"GitHub's platform & community",
		);
	});

	test("decodes numeric and hex entities", () => {
		expect(cleanText("caf&#233; &#x2764;", 100)).toBe("café ❤");
	});

	test("leaves an unknown entity alone", () => {
		expect(cleanText("a &madeup; b", 100)).toBe("a &madeup; b");
	});

	test("strips control and bidi characters", () => {
		// Replaced with a space rather than removed, so two words that were
		// separated only by an invisible character do not fuse together.
		expect(cleanText("safe\u202Eevil\u0000text", 100)).toBe("safe evil text");
	});

	test("collapses whitespace and trims", () => {
		expect(cleanText("  a \n\t b   c  ", 100)).toBe("a b c");
	});

	test("caps the length", () => {
		expect(cleanText("abcdef", 3)).toBe("abc");
	});

	test("treats a non string as empty", () => {
		expect(cleanText(null, 10)).toBe("");
		expect(cleanText(undefined, 10)).toBe("");
	});
});

describe("parsePageMetadata", () => {
	test("prefers Open Graph over the plain title", async () => {
		const meta = await parsePageMetadata(`
			<html><head>
				<title>Plain title</title>
				<meta property="og:title" content="OG title">
				<meta property="og:description" content="OG description">
				<meta property="og:site_name" content="Example">
				<meta property="og:image" content="https://cdn.example.com/a.png">
				<link rel="icon" href="/favicon.ico">
			</head></html>
		`);

		expect(meta.title).toBe("OG title");
		expect(meta.description).toBe("OG description");
		expect(meta.siteName).toBe("Example");
		expect(meta.image).toBe("https://cdn.example.com/a.png");
		expect(meta.favicon).toBe("/favicon.ico");
	});

	test("falls back to twitter cards and the meta description", async () => {
		const meta = await parsePageMetadata(`
			<html><head>
				<title>Plain</title>
				<meta name="twitter:title" content="Tweet title">
				<meta name="description" content="Meta description">
				<meta name="twitter:image" content="/card.png">
			</head></html>
		`);

		expect(meta.title).toBe("Tweet title");
		expect(meta.description).toBe("Meta description");
		expect(meta.image).toBe("/card.png");
	});

	test("captures a base href, which changes relative resolution", async () => {
		const meta = await parsePageMetadata(`
			<html><head>
				<base href="https://cdn.example.com/assets/">
				<meta property="og:image" content="cover.png">
			</head></html>
		`);

		expect(meta.baseHref).toBe("https://cdn.example.com/assets/");
	});

	test("skips an SVG icon in favour of a raster one", async () => {
		const meta = await parsePageMetadata(`
			<html><head>
				<link rel="icon" href="/logo.svg">
				<link rel="apple-touch-icon" href="/touch.png">
			</head></html>
		`);

		expect(meta.favicon).toBe("/touch.png");
	});

	test("returns empty strings for a page with no metadata", async () => {
		const meta = await parsePageMetadata(
			"<html><head></head><body>x</body></html>",
		);

		expect(meta.title).toBe("");
		expect(meta.description).toBe("");
		expect(meta.image).toBe("");
	});
});

describe("decodeHtml", () => {
	test("honours the charset in the content type", () => {
		// 0xE9 is "é" in windows-1252 and invalid on its own in UTF-8.
		const body = Buffer.from([0x63, 0x61, 0x66, 0xe9]);

		expect(decodeHtml(body, "text/html; charset=windows-1252")).toBe("café");
	});

	test("falls back to UTF-8 for an unknown label", () => {
		const body = Buffer.from("hello", "utf8");

		expect(decodeHtml(body, "text/html; charset=not-a-real-charset")).toBe(
			"hello",
		);
	});
});
