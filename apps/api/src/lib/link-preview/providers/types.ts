/**
 * Link preview provider types and host map.
 *
 * Why this file: the adapters, the host lookup and the resolver all name the
 * same provider shape and host table, so they live together.
 *
 * Used by: the modules in `lib/link-preview/providers/`.
 */

export type ProviderField = { label: string; value: string };
export type ProviderMetadata = {
	provider: string;
	kind: string;
	fields: ProviderField[];
};

export type Provider = { name: string; hosts: readonly string[] };
export type ProviderAdapter = (url: URL) => Promise<ProviderMetadata | null>;

/** Providers that receive a useful brand label even when only OG is public. */
export const PROVIDERS: readonly Provider[] = [
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
