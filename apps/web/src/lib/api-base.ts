/**
 * Single source of truth for the API origin.
 *
 * Why: Eden Treaty, Better Auth, the realtime socket and asset URLs all have to
 * agree on one origin. Several separate `import.meta.env.VITE_API_URL` reads let
 * one of them fall back to localhost in a production bundle while the others
 * pointed somewhere else.
 *
 * Production requires `VITE_API_URL`. `vite.config.ts` refuses to build without
 * it, so a deployed bundle can never call the end user's own machine.
 *
 * Used by: src/lib/api.ts, src/features/auth/client.ts, src/lib/files.ts and
 * src/lib/realtime/socket.ts.
 */

/**
 * Resolve the configured origin into a value that paths can be appended to.
 *
 * Exported for tests, so the rule can be checked without running a Vite build.
 */
export function resolveApiOrigin(
	configured: string | undefined,
	isProductionBuild: boolean,
): string {
	const value = configured?.trim();
	if (value) return value.replace(/\/+$/, "");

	// Development and unit tests run against the local API port. This fallback
	// is never available to a production build.
	if (!isProductionBuild) return "http://localhost:3001";

	throw new Error(
		"VITE_API_URL is required for a production build. Set it to the public API origin (for example https://api.example.com) and rebuild.",
	);
}

/**
 * The one API origin every client uses.
 *
 * `import.meta.env.PROD` is true only in a Vite production build, so the
 * localhost fallback stays available to `vite dev` and to unit tests.
 */
const configuredApiUrl: string | undefined = import.meta.env.VITE_API_URL;

export const API_ORIGIN = resolveApiOrigin(
	configuredApiUrl,
	import.meta.env.PROD === true,
);
