/**
 * Tests provider domain matching and ensures provider parsing cannot mistake
 * lookalike hosts for trusted services.
 * Run with: bun test.
 */

import { describe, expect, test } from "bun:test";

import { identifyProvider, parseFigmaCommunityMetadata } from "./providers";

describe("identifyProvider", () => {
	test.each([
		["github.com", "GitHub"],
		["gist.github.com", "GitHub"],
		["gitlab.com", "GitLab"],
		["bitbucket.org", "Bitbucket"],
		["linear.app", "Linear"],
		["jira.example.atlassian.net", "Jira"],
		["trello.com", "Trello"],
		["app.asana.com", "Asana"],
		["figma.com", "Figma"],
		["canva.com", "Canva"],
		["youtube.com", "YouTube"],
		["vimeo.com", "Vimeo"],
		["loom.com", "Loom"],
		["open.spotify.com", "Spotify"],
		["soundcloud.com", "SoundCloud"],
		["notion.so", "Notion"],
		["docs.google.com", "Google Docs"],
		["sheets.google.com", "Google Sheets"],
		["slides.google.com", "Google Slides"],
		["reddit.com", "Reddit"],
		["x.com", "X"],
		["linkedin.com", "LinkedIn"],
		["bsky.app", "Bluesky"],
		["instagram.com", "Instagram"],
		["tiktok.com", "TikTok"],
		["npmjs.com", "npm"],
		["pypi.org", "PyPI"],
		["crates.io", "crates.io"],
		["stackoverflow.com", "Stack Overflow"],
		["codepen.io", "CodePen"],
		["codesandbox.io", "CodeSandbox"],
		["export.arxiv.org", "arXiv"],
		["doi.org", "DOI"],
		["notgithub.com", null],
		["github.com.attacker.example", null],
		["example.com", null],
	])("matches %s as %s", (host, expected) => {
		expect(identifyProvider(host)).toBe(expected);
	});
});

describe("parseFigmaCommunityMetadata", () => {
	test("extracts public community creator and interaction counts", () => {
		const metadata = parseFigmaCommunityMetadata(`
			<script type="application/ld+json">
			{
				"@graph": [
					{"@type":"BreadcrumbList","name":"not the work"},
					{
						"@type":"CreativeWork",
						"creator":{"@type":"Organization","name":"Figma Community"},
						"interactionStatistic":[
							{"interactionType":"https://schema.org/LikeAction","userInteractionCount":138},
							{"interactionType":{"@type":"UseAction"},"userInteractionCount":1448}
						]
					}
				]
			}
			</script>
		`);

		expect(metadata).toEqual({
			provider: "Figma",
			kind: "Community file",
			fields: [
				{ label: "Creator", value: "Figma Community" },
				{ label: "Uses", value: "1,448" },
				{ label: "Likes", value: "138" },
			],
		});
	});

	test("returns no provider fields when the community graph omits them", () => {
		expect(
			parseFigmaCommunityMetadata(
				'<script type="application/ld+json">{"@type":"WebSite"}</script>',
			),
		).toBeNull();
	});
});
