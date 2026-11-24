/**
 * Public surface of the link preview providers module.
 *
 * Why: the resolver should import one entry point instead of reaching into the
 * adapter internals. The public surface is unchanged from the old
 * `providers.ts`.
 *
 * Used by: `lib/link-preview/resolve.ts`.
 */

export { parseFigmaCommunityMetadata } from "./figma";
export { identifyProvider } from "./identify";
export { resolveProviderMetadata } from "./resolve";
export type { ProviderField, ProviderMetadata } from "./types";
