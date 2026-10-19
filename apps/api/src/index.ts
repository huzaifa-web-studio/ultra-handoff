import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { auth } from "./auth";
import { db } from "./db";
import { users } from "./db/schema";

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

const app = new Elysia()
	.use(
		cors({
			origin: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
			methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			credentials: true,
			allowedHeaders: ["Content-Type", "Authorization"],
		}),
	)
	.use(betterAuth)
	.get("/", () => "Hello Huzaifa")
	.get("/health", () => ({ status: "ok" }))
	.get("/users", async () => db.select().from(users))
	.get("/me", ({ user }) => user, { auth: true })
	.listen({ port, hostname });

export type App = typeof app;

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
);
