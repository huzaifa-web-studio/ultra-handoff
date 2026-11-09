/**
 * Attachment viewer routing.
 *
 * Why these exist: the chip and the dialog must agree on what can be previewed.
 * A wrong branch either shows a broken viewer or hides a file the app can render.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { viewerKindFor } from "./viewer-kind";

describe("viewerKindFor", () => {
	test("routes by a specific MIME type", () => {
		expect(viewerKindFor({ name: "brief", mime: "application/pdf" })).toBe(
			"pdf",
		);
		expect(viewerKindFor({ name: "notes", mime: "text/plain" })).toBe("text");
		expect(viewerKindFor({ name: "rows", mime: "text/csv" })).toBe("csv");
		expect(viewerKindFor({ name: "photo", mime: "image/png" })).toBe("image");
		expect(
			viewerKindFor({
				name: "spec",
				mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			}),
		).toBe("docx");
		expect(
			viewerKindFor({
				name: "budget",
				mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
		).toBe("sheet");
	});

	test("falls back to the extension when the MIME is empty or generic", () => {
		expect(
			viewerKindFor({ name: "brief.pdf", mime: "application/octet-stream" }),
		).toBe("pdf");
		expect(viewerKindFor({ name: "notes.txt", mime: "" })).toBe("text");
		expect(viewerKindFor({ name: "rows.csv", mime: "" })).toBe("csv");
		expect(viewerKindFor({ name: "photo.jpeg", mime: "" })).toBe("image");
		expect(viewerKindFor({ name: "photo.avif", mime: "" })).toBe("image");
		expect(viewerKindFor({ name: "spec.docx", mime: "" })).toBe("docx");
		expect(viewerKindFor({ name: "budget.xlsx", mime: "" })).toBe("sheet");
	});

	test("a specific MIME wins over a conflicting file name", () => {
		// Fixed P2-F1: the code now follows the documented precedence.
		expect(viewerKindFor({ name: "report.pdf", mime: "text/csv" })).toBe("csv");
		expect(
			viewerKindFor({
				name: "notes.txt",
				mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			}),
		).toBe("docx");
		expect(viewerKindFor({ name: "photo.txt", mime: "image/png" })).toBe(
			"image",
		);
	});

	test("falls back to the extension when the MIME names no viewer", () => {
		// Windows reports CSV files as application/vnd.ms-excel.
		expect(
			viewerKindFor({ name: "rows.csv", mime: "application/vnd.ms-excel" }),
		).toBe("csv");
		expect(
			viewerKindFor({ name: "slides.pptx", mime: "application/zip" }),
		).toBe("unsupported");
	});

	test("is case insensitive on the extension", () => {
		expect(viewerKindFor({ name: "BRIEF.PDF", mime: "" })).toBe("pdf");
	});

	test("returns unsupported for a type no viewer handles", () => {
		expect(
			viewerKindFor({ name: "archive.zip", mime: "application/zip" }),
		).toBe("unsupported");
		expect(viewerKindFor({ name: "slides.pptx", mime: "" })).toBe(
			"unsupported",
		);
		expect(viewerKindFor({ name: "file", mime: "" })).toBe("unsupported");
	});
});
