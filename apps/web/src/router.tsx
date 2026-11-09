import { createRouter as createTanStackRouter } from "@tanstack/react-router";
// Side effect: disables Zod's `new Function` probe, which the production CSP
// blocks and reports as a violation. Must load before any form validates.
import "#/lib/zod-config";
import { NotFound } from "#/components/not-found";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		defaultNotFoundComponent: NotFound,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
