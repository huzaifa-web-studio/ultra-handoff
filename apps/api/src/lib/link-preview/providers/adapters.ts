/**
 * Public provider adapters.
 *
 * Why this file: each adapter calls a fixed public endpoint without credentials
 * and returns the same metadata shape. Keeping them together means the shared
 * transport and text rules stay visible.
 *
 * Used by: `resolve.ts`.
 */

import { fetchResource } from "../http";
import { fieldsFrom, getJson, record, text } from "./shared";
import type { ProviderMetadata } from "./types";

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

export async function githubMetadata(
	url: URL,
): Promise<ProviderMetadata | null> {
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

export async function gitlabMetadata(
	url: URL,
): Promise<ProviderMetadata | null> {
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

export async function bitbucketMetadata(
	url: URL,
): Promise<ProviderMetadata | null> {
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

export async function stackOverflowMetadata(
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

export async function blueskyMetadata(
	url: URL,
): Promise<ProviderMetadata | null> {
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

export async function oembedMetadata(
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

export async function packageMetadata(
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

export async function doiMetadata(url: URL): Promise<ProviderMetadata | null> {
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

export async function arxivMetadata(
	url: URL,
): Promise<ProviderMetadata | null> {
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
