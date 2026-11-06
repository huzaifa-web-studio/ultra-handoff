import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { betterAuth } from "./auth/plugin";
import { isDevelopment, realtimeEnv, serverEnv } from "./lib/env";
import { tenantPlugin } from "./middleware/tenant";
import { queues } from "./queues";
import { startRealtime } from "./realtime";
import { realtimeRoutes } from "./realtime/gateway";
import { accountRoutes } from "./routes/account";
import { commentRoutes } from "./routes/comments";
import { fileRoutes } from "./routes/files";
import { publicInvitationRoutes } from "./routes/invitations";
import { linkPreviewRoutes } from "./routes/link-previews";
import { memberRoutes } from "./routes/members";
import { mentionRoutes } from "./routes/mentions";
import { milestoneRoutes } from "./routes/milestones";
import { organizationRoutes } from "./routes/organization";
import { projectRoutes } from "./routes/projects";
import { uploadRoutes } from "./routes/uploads";
import { startWorkers } from "./workers";

const { port, host: hostname, webUrl } = serverEnv;

// Bull Board is a development-only dashboard for BullMQ queues.
// It is never mounted in production, so the routes stay inaccessible there.
async function buildApp() {
	const app = new Elysia({
		// Bun rejects an oversized WebSocket frame before Elysia's message parser
		// allocates for it, so the inbound frame limit is enforced at the protocol
		// edge, not only in the handler.
		websocket: { maxPayloadLength: realtimeEnv.maxFrameBytes },
	})
		.use(
			cors({
				origin: webUrl,
				// PATCH is used by the members page to change one role.
				methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
		// Workspace member and invitation management (tenant scoped).
		.use(memberRoutes)
		// Project list, lifecycle and project membership (tenant scoped).
		.use(projectRoutes)
		// Milestones inside a project (tenant scoped).
		.use(milestoneRoutes)
		// Discussion threads on a milestone (tenant scoped).
		.use(commentRoutes)
		// Live comment, milestone and presence stream for the project workspace.
		.use(realtimeRoutes)
		// Mention suggestions for the comment editor (tenant scoped).
		.use(mentionRoutes)
		// Cached link previews for the milestone editor (tenant scoped).
		.use(linkPreviewRoutes)
		// Invitation preview and magic link request for the public accept page.
		.use(publicInvitationRoutes)
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

/**
 * Realtime wire types for the web app.
 *
 * Exported as types only, so the browser bundle never pulls in the server
 * module (which imports node:crypto). The web client validates frames against
 * the same version constant through this contract.
 */
export type {
	RealtimeEnvelope,
	RealtimeEventType,
} from "./realtime/protocol";

void buildApp()
	.then((app) => {
		// Workers share the process so deployment stays a single container.
		// The returned function closes every queue and connection cleanly.
		const stopWorkers = startWorkers();

		app.listen({ port, hostname });

		// Realtime attaches after listen because it needs the running Bun
		// server for topic fan-out. A missing server is a boot error, not a
		// reason to run the API with a silently dead stream.
		const server = app.server;

		if (!server) throw new Error("Realtime requires a listening server");

		const stopRealtime = startRealtime(server);

		const shutdown = async () => {
			// Stop accepting requests first. Better Auth now reads sessions from
			// Redis, so closing the connections before in-flight requests finish
			// would turn a graceful deploy into visible auth errors.
			await app.stop();
			// Close the stream subscriber before the shared Redis client it
			// borrows its connection options from.
			stopRealtime();
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
