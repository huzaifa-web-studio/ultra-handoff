/**
 * Regression tests for URL eligibility used by inline link hover previews.
 * They verify provider links stay in the existing inline-preview path without
 * changing insertion or bookmark conversion behavior.
 * Run with: bun test.
 */

import { describe, expect, test } from "bun:test";

import { extractLinkUrls, isPreviewableHref } from "./utils";

describe("inline link preview URL collection", () => {
	test("keeps provider and arbitrary web URLs previewable", () => {
		const providerUrls = [
			"https://github.com/owner/repo/pull/12",
			"https://linear.app/team/issue/ABC-1",
			"https://youtu.be/video-id",
			"https://docs.google.com/document/d/example/edit",
			"https://arxiv.org/abs/2401.12345",
			"https://unknown.example/path",
		];

		for (const url of providerUrls) {
			expect(isPreviewableHref(url)).toBe(true);
		}
	});

	test("collects inline links and bookmark URLs without transforming nodes", () => {
		const value = [
			{
				type: "p",
				children: [
					{
						type: "a",
						url: "https://github.com/org/repo",
						children: [{ text: "repo" }],
					},
					{ text: " " },
					{
						type: "a",
						url: "https://github.com/org/repo",
						children: [{ text: "duplicate" }],
					},
				],
			},
			{
				type: "bookmark",
				url: "https://figma.com/file/public",
				children: [{ text: "" }],
			},
		];

		expect(extractLinkUrls(value)).toEqual([
			"https://figma.com/file/public",
			"https://github.com/org/repo",
		]);
		expect(value[0]?.type).toBe("p");
	});

	test("rejects non-web schemes for previews", () => {
		expect(isPreviewableHref("javascript:alert(1)")).toBe(false);
		expect(isPreviewableHref("mailto:team@example.com")).toBe(false);
	});
});
