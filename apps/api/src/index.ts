import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { auth } from "./auth";
import { db } from "./db";
import { users } from "./db/schema";
import { queues } from "./queues";

const port = Number(process.env.PORT ?? 3001);
// Elysia defaults to "localhost", which is unreachable from outside the
// container. Bind every interface so the published port actually works.
const hostname = process.env.HOST ?? "0.0.0.0";

const betterAuth = new Elysia({ name: "better-auth" })
	.mount(auth.handler)
	.macro({
		auth: {
			async resolve({ status, request: { headers } }) {
				const session = await auth.api.getSession({ headers });
				if (!session) return status(401);
				return {
					user: session.user,
					session: session.session,
				};
			},
		},
	});

// Bull Board is a development-only dashboard for BullMQ queues.
// It is never mounted in production, so the routes stay inaccessible there.
async function buildApp() {
	const app = new Elysia()
		.use(
			cors({
				origin: process.env.WEB_URL ?? "http://localhost:3000",
				methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
				credentials: true,
				allowedHeaders: ["Content-Type", "Authorization"],
			}),
		)
		.use(betterAuth)
		.get("/", () => "Hello Huzaifa")
		.get("/health", () => ({ status: "ok" }))
		.get("/users", async () => db.select().from(users))
		.get("/me", ({ user }) => user, { auth: true });

	if (process.env.NODE_ENV === "development") {
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

const app = await buildApp();
app.listen({ port, hostname });

export type App = typeof app;

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
