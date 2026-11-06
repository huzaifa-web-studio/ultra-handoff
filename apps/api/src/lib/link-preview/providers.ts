/**
 * Public provider adapters for link previews.
 *
 * Adapters only call fixed, public endpoints without credentials. Their
 * requests use the same DNS-pinned, redirect-validating transport as page
 * metadata, and every displayed value is reduced to plain text.
 * Used by: src/lib/link-preview/resolve.ts.
 */

import { fetchResource } from "./http";
import { cleanText } from "./parse";

export type ProviderField = { label: string; value: string };
export type ProviderMetadata = {
	provider: string;
	kind: string;
	fields: ProviderField[];
};

type Provider = { name: string; hosts: readonly string[] };
type ProviderAdapter = (url: URL) => Promise<ProviderMetadata | null>;

/** Providers that receive a useful brand label even when only OG is public. */
const PROVIDERS: readonly Provider[] = [
	{ name: "GitHub", hosts: ["github.com", "gist.github.com"] },
	{ name: "GitLab", hosts: ["gitlab.com"] },
	{ name: "Bitbucket", hosts: ["bitbucket.org"] },
	{ name: "Linear", hosts: ["linear.app"] },
	{ name: "Jira", hosts: ["atlassian.net", "jira.com"] },
	{ name: "Trello", hosts: ["trello.com"] },
	{ name: "Asana", hosts: ["asana.com"] },
	{ name: "Figma", hosts: ["figma.com"] },
	{ name: "Canva", hosts: ["canva.com"] },
	{ name: "YouTube", hosts: ["youtube.com", "youtu.be"] },
	{ name: "Vimeo", hosts: ["vimeo.com"] },
	{ name: "Loom", hosts: ["loom.com"] },
	{ name: "Spotify", hosts: ["spotify.com", "open.spotify.com"] },
	{ name: "SoundCloud", hosts: ["soundcloud.com"] },
	{ name: "Notion", hosts: ["notion.so", "notion.site"] },
	{ name: "Google Docs", hosts: ["docs.google.com"] },
	{ name: "Google Sheets", hosts: ["sheets.google.com"] },
	{ name: "Google Slides", hosts: ["slides.google.com"] },
	{ name: "Reddit", hosts: ["reddit.com", "redd.it"] },
	{ name: "X", hosts: ["x.com", "twitter.com"] },
	{ name: "LinkedIn", hosts: ["linkedin.com"] },
	{ name: "Bluesky", hosts: ["bsky.app"] },
	{ name: "Instagram", hosts: ["instagram.com"] },
	{ name: "TikTok", hosts: ["tiktok.com"] },
	{ name: "npm", hosts: ["npmjs.com", "npmjs.org"] },
	{ name: "PyPI", hosts: ["pypi.org"] },
	{ name: "crates.io", hosts: ["crates.io"] },
	{ name: "Stack Overflow", hosts: ["stackoverflow.com", "stackexchange.com"] },
	{ name: "CodePen", hosts: ["codepen.io"] },
	{ name: "CodeSandbox", hosts: ["codesandbox.io"] },
	{ name: "arXiv", hosts: ["arxiv.org"] },
	{ name: "DOI", hosts: ["doi.org", "dx.doi.org"] },
];

/** Match exact provider hosts and subdomains without accepting lookalikes. */
export function identifyProvider(hostname: string): string | null {
	const host = hostname.toLowerCase().replace(/^www\./, "");
	return (
		PROVIDERS.find(({ hosts }) =>
			hosts.some((domain) => host === domain || host.endsWith(`.${domain}`)),
		)?.name ?? null
	);
}

/** Extract fields Figma publishes in a community file's JSON-LD graph. */
export function parseFigmaCommunityMetadata(
	html: string,
): ProviderMetadata | null {
	const scripts = html.matchAll(
		/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
	);

	for (const [, content] of scripts) {
		if (!content) continue;
		try {
			const parsed = record(JSON.parse(content) as unknown);
			const graph = parsed?.["@graph"];
			const nodes = Array.isArray(graph) ? graph : [parsed];
			const work = nodes.map(record).find((node) => {
				const type = node?.["@type"];
				return (
					type === "CreativeWork" ||
					(Array.isArray(type) && type.includes("CreativeWork"))
				);
			});
			if (!work) continue;

			const creator = record(work.creator);
			const stats = Array.isArray(work.interactionStatistic)
				? work.interactionStatistic
				: [];
			const likes = stats.find((entry) => {
				const interaction = record(entry)?.interactionType;
				return text(record(interaction)?.["@type"] ?? interaction, 80).endsWith(
					"LikeAction",
				);
			});
			const uses = stats.find((entry) => {
				const interaction = record(entry)?.interactionType;
				return text(record(interaction)?.["@type"] ?? interaction, 80).endsWith(
					"UseAction",
				);
			});
			const fields = fieldsFrom([
				["Creator", creator?.name],
				["Uses", record(uses)?.userInteractionCount],
				["Likes", record(likes)?.userInteractionCount],
			]);
			if (fields.length > 0) {
				return { provider: "Figma", kind: "Community file", fields };
			}
		} catch {
			// A malformed JSON-LD block should not prevent other blocks being read.
		}
	}

	return null;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown, limit = 180): string {
	return typeof value === "string" ? cleanText(value, limit) : "";
}

function number(value: unknown): string {
	return typeof value === "number" && Number.isFinite(value)
		? new Intl.NumberFormat("en").format(value)
		: "";
}

function fieldsFrom(entries: [string, unknown][]): ProviderField[] {
	return entries
		.flatMap(([label, value]) => {
			const formatted = text(value) || number(value);
			return formatted ? [{ label, value: formatted }] : [];
		})
		.slice(0, 6);
}

/** Read JSON only through the hardened URL resolver and bounded transport. */
async function getJson(url: string): Promise<unknown | null> {
	try {
		const result = await fetchResource(url, {
			maxBytes: 128 * 1024,
			acceptContentTypes: ["application/json", "text/json"],
			accept: "application/json",
			timeoutMs: 5_000,
		});
		if (!result.ok) return null;
		return JSON.parse(result.response.body.toString("utf8")) as unknown;
	} catch {
		// Provider outages, malformed JSON and throttling are non-fatal. The
		// resolver still returns the universal page metadata preview.
		return null;
	}
}

function githubRequest(url: URL): string | null {
	const parts = url.pathname.split("/").filter(Boolean);
	if (url.hostname === "gist.github.com" && parts[0]) {
		return `https://api.github.com/gists/${encodeURIComponent(parts.at(-1) ?? "")}`;
	}
	if (url.hostname !== "github.com" || parts.length < 2) return null;
	const [owner, repo, section, id] = parts;
	if (!owner || !repo) return null;
	if (section === "pull" && id) {
		return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(id)}`;
	}
	if (section === "issues" && id) {
		return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(id)}`;
	}
	return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function githubMetadata(url: URL): Promise<ProviderMetadata | null> {
	const endpoint = githubRequest(url);
	if (!endpoint) return null;
	const data = record(await getJson(endpoint));
	if (!data) return null;
	const isGist = url.hostname === "gist.github.com";
	const isPull = url.pathname.includes("/pull/");
	const isIssue = url.pathname.includes("/issues/");
	const kind = isGist
		? "Gist"
		: isPull
			? "Pull request"
			: isIssue
				? "Issue"
				: "Repository";
	const user = record(data.user) ?? record(data.owner);
	const entries: [string, unknown][] = [
		["Author", user?.login],
		["Status", data.merged_at ? "Merged" : data.state],
		["Repository", data.full_name],
		["Stars", data.stargazers_count],
		["Open issues", data.open_issues_count],
		["Additions", data.additions],
		["Deletions", data.deletions],
		["Comments", data.comments],
	];
	const reviewCount = data.requested_reviewers;
	if (Array.isArray(reviewCount) && reviewCount.length > 0) {
		entries.splice(1, 0, [
			"Reviewers",
			reviewCount
				.map((item) => text(record(item)?.login, 40))
				.filter(Boolean)
				.join(", "),
		]);
	}
	return { provider: "GitHub", kind, fields: fieldsFrom(entries) };
}

async function gitlabMetadata(url: URL): Promise<ProviderMetadata | null> {
	if (url.hostname !== "gitlab.com") return null;
	const parts = url.pathname.split("/").filter(Boolean);
	const marker = parts.findIndex(
		(part, index) =>
			part === "-" &&
			["issues", "merge_requests"].includes(parts[index + 1] ?? ""),
	);
	const projectParts = marker >= 0 ? parts.slice(0, marker) : parts;
	if (projectParts.length === 0) return null;
	const project = encodeURIComponent(projectParts.join("/"));
	const itemId = marker >= 0 ? parts[marker + 2] : undefined;
	const isMergeRequest = marker >= 0 && parts[marker + 1] === "merge_requests";
	const endpoint =
		marker >= 0 && itemId
			? `https://gitlab.com/api/v4/projects/${project}/${isMergeRequest ? "merge_requests" : "issues"}/${encodeURIComponent(itemId)}`
			: `https://gitlab.com/api/v4/projects/${project}`;
	const data = record(await getJson(endpoint));
	if (!data) return null;
	const author = record(data.author);
	const reviewers = Array.isArray(data.reviewers)
		? data.reviewers
				.map((person) => text(record(person)?.name, 60))
				.filter(Boolean)
				.join(", ")
		: "";
	const entries: [string, unknown][] = [
		["Author", author?.name],
		["Status", data.state],
		["Repository", data.path_with_namespace],
		["Reviewers", reviewers],
		["Additions", data.additions],
		["Deletions", data.deletions],
	];
	return {
		provider: "GitLab",
		kind:
			marker >= 0 ? (isMergeRequest ? "Merge request" : "Issue") : "Project",
		fields: fieldsFrom(entries),
	};
}

async function bitbucketMetadata(url: URL): Promise<ProviderMetadata | null> {
	if (url.hostname !== "bitbucket.org") return null;
	const [workspace, repo, section, id] = url.pathname
		.split("/")
		.filter(Boolean);
	if (!workspace || !repo) return null;
	const endpoint =
		section === "pull-requests" && id
			? `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/pullrequests/${encodeURIComponent(id)}`
			: section === "issues" && id
				? `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(id)}`
				: `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo)}`;
	const data = record(await getJson(endpoint));
	if (!data) return null;
	const author = record(data.author);
	const state =
		text(data.state) || text(data.mainbranch && record(data.mainbranch)?.name);
	return {
		provider: "Bitbucket",
		kind:
			section === "pull-requests"
				? "Pull request"
				: section === "issues"
					? "Issue"
					: "Repository",
		fields: fieldsFrom([
			["Author", author?.display_name],
			["Status", state],
			["Repository", record(data.repository)?.full_name ?? data.full_name],
			["Comments", data.comment_count],
		]),
	};
}

async function stackOverflowMetadata(
	url: URL,
): Promise<ProviderMetadata | null> {
	if (!url.hostname.endsWith("stackoverflow.com")) return null;
	const questionId = /\/questions\/(\d+)/.exec(url.pathname)?.[1];
	if (!questionId) return null;
	const endpoint = `https://api.stackexchange.com/2.3/questions/${questionId}?site=stackoverflow&filter=default`;
	const response = record(await getJson(endpoint));
	const items = response?.items;
	const question = Array.isArray(items) ? record(items[0]) : null;
	if (!question) return null;
	return {
		provider: "Stack Overflow",
		kind: "Question",
		fields: fieldsFrom([
			["Author", question.owner && record(question.owner)?.display_name],
			["Score", question.score],
			["Answers", question.answer_count],
			["Status", question.is_answered ? "Answered" : "Open"],
		]),
	};
}

async function blueskyMetadata(url: URL): Promise<ProviderMetadata | null> {
	const match = /\/profile\/([^/]+)\/post\/([^/]+)/.exec(url.pathname);
	if (!match?.[1] || !match[2]) return null;
	const uri = `at://${match[1]}/app.bsky.feed.post/${match[2]}`;
	const endpoint = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}`;
	const data = record(await getJson(endpoint));
	const thread = record(data?.thread);
	const post = record(thread?.post);
	const author = record(post?.author);
	if (!post) return null;
	return {
		provider: "Bluesky",
		kind: "Post",
		fields: fieldsFrom([
			["Author", author?.displayName || author?.handle],
			["Likes", record(post.likeCount)?.value ?? post.likeCount],
			["Replies", record(post.replyCount)?.value ?? post.replyCount],
			["Reposts", post.repostCount],
		]),
	};
}

function oembedEndpoint(provider: string, url: URL): string | null {
	const encoded = encodeURIComponent(url.toString());
	if (provider === "YouTube")
		return `https://www.youtube.com/oembed?url=${encoded}&format=json`;
	if (provider === "Vimeo")
		return `https://vimeo.com/api/oembed.json?url=${encoded}`;
	if (provider === "Spotify")
		return `https://open.spotify.com/oembed?url=${encoded}`;
	if (provider === "SoundCloud")
		return `https://soundcloud.com/oembed?format=json&url=${encoded}`;
	if (provider === "Loom")
		return `https://www.loom.com/v1/oembed?url=${encoded}`;
	return null;
}

async function oembedMetadata(
	provider: string,
	url: URL,
): Promise<ProviderMetadata | null> {
	const endpoint = oembedEndpoint(provider, url);
	if (!endpoint) return null;
	const data = record(await getJson(endpoint));
	if (!data) return null;
	const duration =
		typeof data.duration === "number" && data.duration > 0
			? `${Math.floor(data.duration / 60)}:${String(data.duration % 60).padStart(2, "0")}`
			: "";
	return {
		provider,
		kind:
			provider === "Spotify" || provider === "SoundCloud" ? "Media" : "Video",
		fields: fieldsFrom([
			["Author", data.author_name],
			["Duration", duration],
			["Type", data.type],
		]),
	};
}

async function packageMetadata(
	provider: string,
	url: URL,
): Promise<ProviderMetadata | null> {
	const path = url.pathname.split("/").filter(Boolean);
	const packageIndex = path.indexOf("package");
	const packageName =
		provider === "npm"
			? packageIndex >= 0
				? path.slice(packageIndex + 1).join("/")
				: undefined
			: path[0];
	if (!packageName) return null;
	const endpoint =
		provider === "npm"
			? `https://registry.npmjs.org/${encodeURIComponent(packageName)}`
			: provider === "PyPI"
				? `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`
				: `https://crates.io/api/v1/crates/${encodeURIComponent(packageName)}`;
	const data = record(await getJson(endpoint));
	if (!data) return null;
	const info =
		provider === "PyPI"
			? record(data.info)
			: provider === "crates.io"
				? record(data.crate)
				: data;
	if (!info) return null;
	const version =
		provider === "npm"
			? record(data["dist-tags"])?.latest
			: provider === "PyPI"
				? info.version
				: info.newest_version;
	return {
		provider,
		kind: "Package",
		fields: fieldsFrom([
			["Version", version],
			["Author", info.author],
			["License", info.license],
			["Downloads", info.downloads],
		]),
	};
}

async function doiMetadata(url: URL): Promise<ProviderMetadata | null> {
	const doi = decodeURIComponent(url.pathname.replace(/^\//, ""));
	if (!doi) return null;
	const data = record(
		await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`),
	);
	const message = record(data?.message);
	if (!message) return null;
	const authors = Array.isArray(message.author)
		? message.author
				.slice(0, 3)
				.map((entry) => {
					const author = record(entry);
					return [text(author?.given, 40), text(author?.family, 60)]
						.filter(Boolean)
						.join(" ");
				})
				.filter(Boolean)
				.join(", ")
		: "";
	const dateParts = record(message.published)?.["date-parts"];
	const year = Array.isArray(dateParts) ? dateParts[0] : null;
	return {
		provider: "DOI",
		kind: "Research paper",
		fields: fieldsFrom([
			["Authors", authors],
			["Published", Array.isArray(year) ? year[0] : ""],
			[
				"Journal",
				Array.isArray(message["container-title"])
					? message["container-title"][0]
					: "",
			],
			["DOI", doi],
		]),
	};
}

async function arxivMetadata(url: URL): Promise<ProviderMetadata | null> {
	const match = /(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/.exec(url.pathname);
	if (!match?.[1]) return null;
	try {
		const result = await fetchResource(
			`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(match[1])}`,
			{
				maxBytes: 128 * 1024,
				acceptContentTypes: [
					"application/atom+xml",
					"text/xml",
					"application/xml",
				],
				accept: "application/atom+xml,application/xml;q=0.9",
				timeoutMs: 5_000,
			},
		);
		if (!result.ok) return null;
		const xml = result.response.body.toString("utf8");
		const entry = /<entry>([\s\S]*?)<\/entry>/i.exec(xml)?.[1] ?? "";
		const title = /<title>([\s\S]*?)<\/title>/i.exec(entry)?.[1] ?? "";
		const authorNames = [
			...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/gi),
		]
			.slice(0, 3)
			.map((entry) => text(entry[1], 80))
			.filter(Boolean)
			.join(", ");
		const published = /<published>(\d{4})-\d{2}-\d{2}/i.exec(entry)?.[1] ?? "";
		const fields = fieldsFrom([
			["Title", title],
			["Authors", authorNames],
			["Published", published],
			["arXiv ID", match[1]],
		]);
		return { provider: "arXiv", kind: "Research paper", fields };
	} catch {
		return null;
	}
}

/** One adapter registry keeps host recognition separate from API strategy. */
const ADAPTERS: Readonly<Record<string, ProviderAdapter>> = {
	GitHub: githubMetadata,
	GitLab: gitlabMetadata,
	Bitbucket: bitbucketMetadata,
	"Stack Overflow": stackOverflowMetadata,
	Bluesky: blueskyMetadata,
	YouTube: (url) => oembedMetadata("YouTube", url),
	Vimeo: (url) => oembedMetadata("Vimeo", url),
	Loom: (url) => oembedMetadata("Loom", url),
	Spotify: (url) => oembedMetadata("Spotify", url),
	SoundCloud: (url) => oembedMetadata("SoundCloud", url),
	npm: (url) => packageMetadata("npm", url),
	PyPI: (url) => packageMetadata("PyPI", url),
	"crates.io": (url) => packageMetadata("crates.io", url),
	DOI: doiMetadata,
	arXiv: arxivMetadata,
};

/** Resolve the best-effort adapter result for an arbitrary public URL. */
export async function resolveProviderMetadata(
	rawUrl: string,
): Promise<ProviderMetadata | null> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	const provider = identifyProvider(url.hostname);
	if (!provider) return null;
	try {
		const adapter = ADAPTERS[provider];
		return adapter
			? await adapter(url)
			: { provider, kind: "Link", fields: [] };
	} catch {
		// Malformed encoded URLs and provider payloads must not fail the OG fetch.
		return null;
	}
}
