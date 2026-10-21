import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { betterAuth } from "./auth/plugin";
import { isDevelopment, serverEnv } from "./lib/env";
import { tenantPlugin } from "./middleware/tenant";
import { queues } from "./queues";
import { accountRoutes } from "./routes/account";
import { fileRoutes } from "./routes/files";
import { organizationRoutes } from "./routes/organization";
import { uploadRoutes } from "./routes/uploads";
import { startWorkers } from "./workers";

const { port, host: hostname, webUrl } = serverEnv;

// Bull Board is a development-only dashboard for BullMQ queues.
// It is never mounted in production, so the routes stay inaccessible there.
async function buildApp() {
	const app = new Elysia()
		.use(
			cors({
				origin: webUrl,
				methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
				credentials: true,
				allowedHeaders: ["Content-Type", "Authorization"],
			}),
		)
		.use(betterAuth)
		// Exposes the `tenant` macro. Routes opt in with `{ tenant: true }`
		// and must live under an `:orgSlug` path.
		.use(tenantPlugin)
		// Account level routes. Uploads are user scoped, not tenant scoped.
		.use(uploadRoutes)
		.use(fileRoutes)
		.use(accountRoutes)
		.use(organizationRoutes)
		.get("/", () => "Hello Huzaifa")
		.get("/health", () => ({ status: "ok" }));

	if (isDevelopment) {
		const { openapi } = await import("@elysiajs/openapi");
		app.use(openapi());

		const { createBullBoard } = await import("@bull-board/api");
		const { BullMQAdapter } = await import("@bull-board/api/bullMQAdapter");
		const { ElysiaAdapter } = await import("@bull-board/elysia");

		const serverAdapter = new ElysiaAdapter({
			prefix: "/bull-board",
			basePath: "/bull-board",
		});

		createBullBoard({
			queues: queues.map((queue) => new BullMQAdapter(queue)),
			serverAdapter,
		});

		app.use(await serverAdapter.registerPlugin());
	}

	return app;
}

// Top-level await is not supported by `bun build --compile`, so the async
// bootstrap runs through a promise chain instead. The exported type is derived
// from the builder, keeping Eden Treaty types intact.
export type App = Awaited<ReturnType<typeof buildApp>>;

void buildApp()
	.then((app) => {
		// Workers share the process so deployment stays a single container.
		// The returned function closes every queue and connection cleanly.
		const stopWorkers = startWorkers();

		app.listen({ port, hostname });

		const shutdown = async () => {
			// Stop accepting requests first. Better Auth now reads sessions from
			// Redis, so closing the connections before in-flight requests finish
			// would turn a graceful deploy into visible auth errors.
			await app.stop();
			// A failing Redis connection must not stop the HTTP server from
			// closing cleanly during a deploy.
			await stopWorkers().catch(() => undefined);
			process.exit(0);
		};

		process.once("SIGTERM", shutdown);
		process.once("SIGINT", shutdown);

		console.log(
			`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
		);
	})
	.catch((error) => {
		console.error("Failed to start API", error);
		process.exit(1);
	});
