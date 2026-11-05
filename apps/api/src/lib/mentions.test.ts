/**
 * Tests for mention key parsing.
 *
 * Why these exist: the key is the only machine readable part of a mention, and
 * a malformed key must never be interpreted as a valid target. The sanitizer
 * and the access check both depend on this grammar, so it is tested on its own.
 */

import { describe, expect, test } from "bun:test";

import { collectMentionKeys, mentionKey, parseMentionKey } from "./mentions";

describe("parseMentionKey", () => {
	test("reads the three supported types", () => {
		expect(parseMentionKey("user:user-1")).toEqual({
			type: "user",
			id: "user-1",
		});
		expect(parseMentionKey("project:project_1")).toEqual({
			type: "project",
			id: "project_1",
		});
		expect(parseMentionKey("milestone:abc123")).toEqual({
			type: "milestone",
			id: "abc123",
		});
	});

	test("rejects an unknown type, an empty id and a non string", () => {
		expect(parseMentionKey("location:abc")).toBeNull();
		expect(parseMentionKey("user:")).toBeNull();
		expect(parseMentionKey("user:abc/def")).toBeNull();
		expect(parseMentionKey(42)).toBeNull();
	});
});

describe("mentionKey", () => {
	test("builds the canonical form", () => {
		expect(mentionKey("project", "abc")).toBe("project:abc");
	});
});

describe("collectMentionKeys", () => {
	test("finds nested mentions once each", () => {
		const body = [
			{
				type: "p",
				children: [
					{
						type: "mention",
						key: "user:user-1",
						value: "Jane",
						children: [{ text: "" }],
					},
					{ text: " and " },
					{
						type: "mention",
						key: "user:user-1",
						value: "Jane",
						children: [{ text: "" }],
					},
					{
						type: "mention",
						key: "milestone:milestone-1",
						value: "Delivery",
						children: [{ text: "" }],
					},
				],
			},
		];

		expect(collectMentionKeys(body)).toEqual([
			{ type: "user", id: "user-1" },
			{ type: "milestone", id: "milestone-1" },
		]);
	});

	test("ignores malformed mentions", () => {
		expect(
			collectMentionKeys([
				{
					type: "p",
					children: [
						{
							type: "mention",
							key: "user:",
							value: "Nobody",
							children: [{ text: "" }],
						},
					],
				},
			]),
		).toEqual([]);
	});
});
