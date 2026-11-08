import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

/**
 * Refuse to build a production bundle without the API origin.
 *
 * Why here: `VITE_API_URL` is inlined into the client bundle at build time. If
 * it is missing, the old code shipped a bundle that called
 * `http://localhost:3001`, which points at the end user's own machine. Failing
 * the build turns a broken deployment into an obvious CI error.
 *
 * `import.meta.env` does not exist in the config process, so the value comes
 * from the environment that the Docker build arg sets.
 */
function assertProductionApiUrl(): void {
	if (process.env.VITE_API_URL?.trim()) return;

	throw new Error(
		"VITE_API_URL is required for a production build. Set it to the public API origin (for example https://api.example.com) and rebuild.",
	);
}

const config = defineConfig(({ command }) => {
	// `vite build` is the only command that produces a deployable bundle.
	// `vite dev` and `vite preview` keep the localhost fallback.
	if (command === "build") assertProductionApiUrl();

	return {
		resolve: { tsconfigPaths: true },
		plugins: [
			devtools(),
			tailwindcss(),
			tanstackStart({
				spa: {
					enabled: true,
				},
			}),
			nitro(),
			viteReact(),
		],
	};
});

export default config;
