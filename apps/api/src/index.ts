import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { betterAuth } from "./auth/plugin";
import { isDevelopment, serverEnv } from "./lib/env";
import { queues } from "./queues";

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
		app.listen({ port, hostname });

		console.log(
			`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
		);
	})
	.catch((error) => {
		console.error("Failed to start API", error);
		process.exit(1);
	});
