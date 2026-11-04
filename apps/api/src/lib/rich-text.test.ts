/**
 * Sanitizer tests for the shared rich text walk.
 *
 * Why these exist: the comment profile is the security boundary between an
 * editor value and a database column every participant renders. The tests pin
 * the two things that matter most: comments cannot smuggle in block types the
 * comment editor does not offer, and the milestone profile is unchanged by the
 * profile refactor.
 */

import { describe, expect, test } from "bun:test";
import { APIError } from "better-auth/api";

import { sanitizeCommentBody, sanitizeRichText } from "./rich-text";

/** Build a paragraph with one text leaf. */
function paragraph(text: string, marks: Record<string, boolean> = {}) {
	return { type: "p", children: [{ text, ...marks }] };
}

describe("sanitizeCommentBody", () => {
	test("keeps paragraphs, marks, lists and links", () => {
		const value = [
			paragraph("Hello ", { bold: true }),
			{
				type: "ul",
				children: [
					{
						type: "li",
						children: [{ type: "lic", children: [{ text: "First point" }] }],
					},
				],
			},
			{
				type: "p",
				children: [
					{
						type: "a",
						url: "https://example.com/docs",
						children: [{ text: "Docs", underline: true }],
					},
				],
			},
		];

		const result = sanitizeCommentBody(value);

		expect(result.value).toHaveLength(3);

		const list = result.value[1] as {
			type: string;
			children: { type: string }[];
		};
		expect(list.type).toBe("ul");
		expect(list.children[0]?.type).toBe("li");

		const link = (result.value[2] as { children: { type?: string }[] })
			.children[0];
		expect(link?.type).toBe("a");
	});

	test("keeps images, bookmarks and attachments", () => {
		const result = sanitizeCommentBody([
			paragraph("Before"),
			{
				type: "img",
				url: "/files/organizations/org/comments/images/shot.png",
				alt: "Screenshot",
				children: [{ text: "" }],
			},
			{
				type: "bookmark",
				url: "https://example.com",
				children: [{ text: "" }],
			},
			{
				type: "file",
				url: "/files/organizations/org/comments/files/brief.pdf",
				name: "Brief.pdf",
				mime: "application/pdf",
				size: 2048,
				children: [{ text: "" }],
			},
			paragraph("After"),
		]);

		const types = result.value.map((node) => (node as { type?: string }).type);

		expect(types).toEqual(["p", "img", "bookmark", "file", "p"]);

		const file = result.value[3] as {
			name: string;
			mime: string;
			size: number;
		};
		expect(file.name).toBe("Brief.pdf");
		expect(file.mime).toBe("application/pdf");
		expect(file.size).toBe(2048);
	});

	test("drops an attachment whose URL is not safe to link", () => {
		const result = sanitizeCommentBody([
			{
				type: "file",
				url: "javascript:alert(1)",
				name: "Bad.pdf",
				children: [{ text: "" }],
			},
			paragraph("Body"),
		]);

		const types = result.value.map((node) => (node as { type?: string }).type);

		expect(types).toEqual(["p"]);
	});

	test("keeps a table inside a comment", () => {
		const result = sanitizeCommentBody([
			{
				type: "table",
				children: [
					{
						type: "tr",
						children: [
							{
								type: "th",
								children: [{ text: "Item" }],
							},
							{
								type: "td",
								children: [{ text: "Done" }],
							},
						],
					},
				],
			},
		]);

		expect((result.value[0] as { type?: string }).type).toBe("table");
	});

	test("drops a javascript link instead of storing it", () => {
		const result = sanitizeCommentBody([
			{
				type: "p",
				children: [
					{
						type: "a",
						url: "javascript:alert(1)",
						children: [{ text: "Click" }],
					},
				],
			},
		]);

		const link = (result.value[0] as { children: { url?: string }[] })
			.children[0];

		expect(link?.url).toBeUndefined();
	});

	test("accepts an image with no text", () => {
		const result = sanitizeCommentBody([
			{
				type: "img",
				url: "/files/organizations/org/comments/images/shot.png",
				children: [{ text: "" }],
			},
		]);

		expect((result.value[0] as { type?: string }).type).toBe("img");
	});

	test("accepts a file with no text", () => {
		const result = sanitizeCommentBody([
			{
				type: "file",
				url: "/files/organizations/org/comments/files/brief.pdf",
				name: "Brief.pdf",
				mime: "application/pdf",
				size: 2048,
				children: [{ text: "" }],
			},
		]);

		expect((result.value[0] as { type?: string }).type).toBe("file");
	});

	test("accepts a bookmark with no text", () => {
		const result = sanitizeCommentBody([
			{
				type: "bookmark",
				url: "https://example.com",
				children: [{ text: "" }],
			},
		]);

		expect((result.value[0] as { type?: string }).type).toBe("bookmark");
	});

	test("gives checklist items a stable id and keeps an existing one", () => {
		const generated = sanitizeCommentBody([
			{
				type: "taskList",
				children: [
					{
						type: "li",
						checked: false,
						children: [{ type: "lic", children: [{ text: "Ship it" }] }],
					},
				],
			},
		]);

		const generatedItem = (
			generated.value[0] as {
				children: { id?: string }[];
			}
		).children[0];

		expect(typeof generatedItem?.id).toBe("string");
		expect(generatedItem?.id?.length).toBeGreaterThan(0);

		const preserved = sanitizeCommentBody([
			{
				type: "taskList",
				children: [
					{
						type: "li",
						id: "item-1",
						checked: true,
						children: [{ type: "lic", children: [{ text: "Already done" }] }],
					},
				],
			},
		]);

		const preservedItem = (
			preserved.value[0] as {
				children: { id?: string; checked?: boolean }[];
			}
		).children[0];

		expect(preservedItem?.id).toBe("item-1");
		expect(preservedItem?.checked).toBe(true);
	});

	test("rejects a body with no visible text", () => {
		expect(() => sanitizeCommentBody([paragraph("   ")])).toThrow(APIError);
	});

	test("rejects a body that is not an editor document", () => {
		expect(() => sanitizeCommentBody("just a string")).toThrow(APIError);
	});

	test("produces a plain text mirror used by previews and checks", () => {
		const result = sanitizeCommentBody([
			paragraph("Please review the homepage."),
			{
				type: "ol",
				children: [
					{
						type: "li",
						children: [{ type: "lic", children: [{ text: "Hero section" }] }],
					},
				],
			},
		]);

		expect(result.text).toContain("Please review the homepage.");
		expect(result.text).toContain("Hero section");
	});
});

describe("sanitizeRichText (milestone profile)", () => {
	test("still keeps tables and images for a milestone description", () => {
		const result = sanitizeRichText([
			{
				type: "img",
				url: "/files/organizations/org/projects/project/image.png",
				children: [{ text: "" }],
			},
		]);

		expect(result.value).toHaveLength(1);
		expect((result.value[0] as { type?: string }).type).toBe("img");
	});

	test("drops an attachment node, which only comments support", () => {
		const result = sanitizeRichText([
			{
				type: "file",
				url: "/files/organizations/org/comments/files/brief.pdf",
				name: "Brief.pdf",
				children: [{ text: "" }],
			},
			paragraph("Body"),
		]);

		expect(result.value).toHaveLength(1);
		expect((result.value[0] as { type?: string }).type).toBe("p");
	});
});
