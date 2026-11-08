/**
 * Rich text key extraction and download name sanitising.
 *
 * Why these exist: cleanup decides which objects to delete from whatever the
 * walk finds. A missed shape leaks an attachment, and an over-eager walk could
 * delete an unrelated object. Both are pure checks.
 *
 * Run with: bun test
 */

import { describe, expect, test } from "bun:test";

import { keyFromRichText, safeDownloadName } from "./keys";

describe("keyFromRichText", () => {
	test("collects image and attachment references", () => {
		const keys = keyFromRichText([
			{
				type: "p",
				children: [{ text: "See the brief" }],
			},
			{
				type: "img",
				url: "/files/organizations/org-1/comments/images/shot.png",
				children: [{ text: "" }],
			},
			{
				type: "file",
				url: "/files/organizations/org-1/comments/files/brief.pdf",
				name: "Brief.pdf",
				children: [{ text: "" }],
			},
		]);

		expect(keys).toEqual([
			"organizations/org-1/comments/images/shot.png",
			"organizations/org-1/comments/files/brief.pdf",
		]);
	});

	test("ignores external URLs and text mentions", () => {
		const keys = keyFromRichText([
			{ type: "img", url: "https://example.com/tracker.png" },
			{ type: "bookmark", url: "https://example.com" },
			{ type: "p", children: [{ text: "not a reference" }] },
		]);

		expect(keys).toEqual([]);
	});

	test("deduplicates a key referenced twice", () => {
		const keys = keyFromRichText([
			{ type: "img", url: "/files/organizations/org-1/milestones/i.png" },
			{ type: "img", url: "/files/organizations/org-1/milestones/i.png" },
		]);

		expect(keys).toHaveLength(1);
	});

	test("strips a query string or fragment before reading the key", () => {
		expect(
			keyFromRichText(
				"/files/organizations/org-1/comments/files/brief.pdf?download=1",
			),
		).toEqual(["organizations/org-1/comments/files/brief.pdf"]);

		expect(
			keyFromRichText(
				"/files/organizations/org-1/comments/files/brief.pdf#page=2",
			),
		).toEqual(["organizations/org-1/comments/files/brief.pdf"]);
	});

	test("rejects traversal and malformed references", () => {
		expect(keyFromRichText("/files/organizations/org-1/../secret.pdf")).toEqual(
			[],
		);
		expect(keyFromRichText("/files/organizations//org-1/a.pdf")).toEqual([]);
		expect(keyFromRichText("/files/")).toEqual([]);
		expect(keyFromRichText("/files/%E0%A4%A")).toEqual([]);
	});

	test("handles a null or primitive value", () => {
		expect(keyFromRichText(null)).toEqual([]);
		expect(keyFromRichText(42)).toEqual([]);
		expect(keyFromRichText("plain text")).toEqual([]);
	});
});

describe("safeDownloadName", () => {
	test("keeps a normal file name", () => {
		expect(safeDownloadName("qa-brief.pdf")).toBe("qa-brief.pdf");
	});

	test("strips quotes, control characters and path separators", () => {
		expect(safeDownloadName('12"3.pdf')).toBe("123.pdf");
		expect(safeDownloadName("a\r\nb.pdf")).toBe("ab.pdf");
		expect(safeDownloadName("../../etc/passwd")).toBe("....etcpasswd");
		expect(safeDownloadName("folder\\file.pdf")).toBe("folderfile.pdf");
	});

	test("returns null for an empty or missing name", () => {
		expect(safeDownloadName(null)).toBeNull();
		expect(safeDownloadName("   ")).toBeNull();
		expect(safeDownloadName('"""')).toBeNull();
	});

	test("caps the length", () => {
		expect(safeDownloadName("a".repeat(400))).toHaveLength(120);
	});
});
