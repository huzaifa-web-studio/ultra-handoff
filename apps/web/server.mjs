/**
 * Production server for the TanStack Start build.
 *
 * Start 1.169 ships no Nitro bundle, so `vite build` emits:
 *   dist/client  — hashed client assets (plain files, no HTML shell)
 *   dist/server  — a WinterCG `fetch` handler: no listen(), no port binding
 *
 * srvx gives that handler a real HTTP server plus static asset serving. The
 * CLI equivalent is `bunx --bun srvx --prod -s ./dist/client <entry>`, written
 * out here so the runtime honours PORT/HOST and the entry can be resolved
 * without guessing the emitted filename.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";

const dist = join(import.meta.dir, "dist");
const serverDir = join(dist, "server");
const clientDir = join(dist, "client");

/**
 * Resolve the SSR entry inside dist/server.
 *
 * The build emits `server.js` in practice, but the name is derived from a
 * virtual Rollup input id, so it is not a contract we should hard-depend on.
 * Fall back to the largest emitted module: the entry inlines or imports every
 * chunk, so it is always the biggest file in the directory.
 */
function resolveServerEntry() {
	const preferred = ["server.js", "server.mjs", "index.js", "index.mjs"];
	for (const name of preferred) {
		const candidate = join(serverDir, name);
		if (existsSync(candidate)) return candidate;
	}

	if (!existsSync(serverDir)) return null;

	return (
		readdirSync(serverDir)
			.filter((file) => file.endsWith(".js") || file.endsWith(".mjs"))
			.map((file) => join(serverDir, file))
			.sort((a, b) => statSync(b).size - statSync(a).size)[0] ?? null
	);
}

const entry = resolveServerEntry();

if (!entry) {
	throw new Error(
		`No SSR bundle found in ${serverDir}. Run \`bun run build\` first.`,
	);
}

const module = await import(entry);
const fetchHandler = module.fetch ?? module.default?.fetch ?? module.default;

if (typeof fetchHandler !== "function") {
	throw new Error(`${entry} does not export a fetch handler.`);
}

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

const server = serve({
	port,
	hostname,
	fetch: fetchHandler,
	middleware: existsSync(clientDir)
		? [staticMiddleware({ dir: clientDir })]
		: [],
});

await server.ready();

console.log(`🌐 web listening on http://${hostname}:${port} (entry: ${entry})`);
